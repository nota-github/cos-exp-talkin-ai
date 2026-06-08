import { randomUUID } from 'node:crypto';
import type {
  ChatFeedItem,
  ChatFeedQuery,
  ChatFeedResult,
  CloudModelId,
  OptimizationMode,
  RetryRunCommand,
  RetryRunResult,
  SubmitPromptCommand,
  SubmitPromptResult,
  TaskStatus,
} from '../../shared/ipc/contracts';
import {
  createChatRunPersistence,
  type ChatRunPersistence,
  type ProviderId,
} from '../persistence/index.ts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';
import {
  listConversationMessages,
  listConversationRuns,
} from './feed-projection.ts';
import type { OptimizationStageOrchestrator } from '../workflows/index.ts';

type SqlPrimitive = string | number | null;

type PersistentChatHistoryServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
  createId?: (prefix: string) => string;
  optimizationStageOrchestrator?: OptimizationStageOrchestrator;
  onBackgroundWorkflowError?: (input: {
    operation: 'optimizeQueuedRun';
    runId: string;
    error: unknown;
  }) => void;
};

type TaskFeedRow = {
  task_id: string;
  title: string;
  status: TaskStatus;
  last_activity_at: string;
  conversation_id: string | null;
  selected_model: CloudModelId | null;
  mode: OptimizationMode | null;
  preview: string | null;
};

export interface ChatHistoryService {
  submitPrompt(request: SubmitPromptCommand): Promise<SubmitPromptResult>;
  retryRun(request: RetryRunCommand): Promise<RetryRunResult>;
  getChatFeed(request: ChatFeedQuery): Promise<ChatFeedResult>;
}

const recommendedPrompts = [
  '사업계획서 초안을 한국어로 구조화해줘',
  '긴 PDF 핵심만 7개 항목으로 요약해줘',
  '브랜드 카피를 더 또렷한 문장으로 다듬어줘',
] as const;

const providerByModel: Record<CloudModelId, ProviderId> = {
  'gpt-4.1': 'openai',
  'claude-sonnet-4': 'anthropic',
  'gemini-1.5-pro': 'google',
};

function sqlValue(value: SqlPrimitive): string {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot store non-finite number in SQLite: ${value}`);
    }

    return String(value);
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeTitle(promptKo: string) {
  const firstNonEmptyLine =
    promptKo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';
  const collapsed = firstNonEmptyLine.replace(/\s+/g, ' ');

  if (!collapsed) {
    return '새 한국어 작업';
  }

  if (collapsed.length <= 26) {
    return collapsed;
  }

  return `${collapsed.slice(0, 26).trimEnd()}...`;
}

function normalizeSummary(promptKo: string) {
  const collapsed = promptKo.replace(/\s+/g, ' ').trim();

  if (!collapsed) {
    return null;
  }

  if (collapsed.length <= 120) {
    return collapsed;
  }

  return `${collapsed.slice(0, 120).trimEnd()}...`;
}

function createEmptyChatFeed(): ChatFeedResult {
  return {
    activeConversationId: null,
    activeTaskId: null,
    activeTaskTitle: null,
    recommendedPrompts: [...recommendedPrompts],
    items: [],
    messages: [],
    runs: [],
    activeRun: null,
  };
}

async function withChatPersistence<TValue>(
  options: PersistentChatHistoryServiceOptions,
  work: (persistence: ChatRunPersistence, connection: SqliteConnection) => Promise<TValue>,
) {
  const openDatabase = options.openDatabase ?? openSqliteDatabase;
  const migrateSchema = options.migrateSchema ?? migrateDesktopSchema;
  const handle = await openDatabase(options.dbPath);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await migrateSchema(handle.connection);
    return await work(persistence, handle.connection);
  } finally {
    await persistence.close();
  }
}

async function listTaskFeedRows(connection: SqliteConnection) {
  return connection.query<TaskFeedRow>(`
    SELECT
      tasks.id AS task_id,
      tasks.title AS title,
      tasks.status AS status,
      tasks.last_activity_at AS last_activity_at,
      conversations.id AS conversation_id,
      conversations.selected_model AS selected_model,
      conversations.mode AS mode,
      (
        SELECT messages.content_ko
        FROM messages
        WHERE messages.conversation_id = conversations.id
        ORDER BY messages.created_at DESC
        LIMIT 1
      ) AS preview
    FROM tasks
    LEFT JOIN conversations
      ON conversations.id = (
        SELECT candidate.id
        FROM conversations AS candidate
        WHERE candidate.task_id = tasks.id
        ORDER BY candidate.created_at DESC
        LIMIT 1
      )
    ORDER BY tasks.last_activity_at DESC, tasks.created_at DESC;
  `);
}

function mapFeedItems(rows: TaskFeedRow[]): ChatFeedItem[] {
  return rows.map((row) => ({
    taskId: row.task_id,
    conversationId: row.conversation_id ?? '',
    title: row.title,
    preview: row.preview ?? '',
    status: row.status,
    model: row.selected_model ?? 'gpt-4.1',
    mode: row.mode ?? 'balanced',
    savingsRate: 0,
    updatedAt: row.last_activity_at,
  }));
}

export function createPersistentChatHistoryService(
  options: PersistentChatHistoryServiceOptions,
): ChatHistoryService {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);

  function queueBackgroundOptimization(runId: string) {
    if (!options.optimizationStageOrchestrator) {
      return;
    }

    void Promise.resolve()
      .then(() =>
        options.optimizationStageOrchestrator?.optimizeQueuedRun({
          runId,
        }),
      )
      .catch((error) => {
        options.onBackgroundWorkflowError?.({
          operation: 'optimizeQueuedRun',
          runId,
          error,
        });
      });
  }

  return {
    async submitPrompt(request) {
      const result = await withChatPersistence(options, async (persistence) => {
        const createdAt = now();
        const messageId = createId('message');
        const runId = createId('run');
        const stageId = createId('stage');

        if (request.conversationId) {
          return persistence.transaction(async (tx) => {
            const conversation = await tx.conversations.getById(request.conversationId);

            if (!conversation) {
              throw new Error('이어갈 대화를 찾을 수 없습니다.');
            }

            const task = await tx.tasks.getById(conversation.taskId);

            if (!task) {
              throw new Error('이어갈 작업을 찾을 수 없습니다.');
            }

            const existingRuns = await tx.runRecords.listByConversation(conversation.id);
            const latestRun = existingRuns.at(-1) ?? null;

            if (
              latestRun &&
              latestRun.status !== 'completed' &&
              latestRun.status !== 'failed'
            ) {
              throw new Error('이 패널의 이전 실행이 아직 진행 중입니다.');
            }

            await tx.conversations.update({
              conversationId: conversation.id,
              summary: normalizeSummary(request.promptKo),
              mode: request.optimizationMode,
              selectedModel: request.selectedModel,
              updatedAt: createdAt,
            });

            await tx.messages.create({
              id: messageId,
              conversationId: conversation.id,
              role: 'user',
              contentKo: request.promptKo,
              runId,
              createdAt,
            });

            await tx.runRecords.create({
              id: runId,
              taskId: task.id,
              conversationId: conversation.id,
              messageId,
              status: 'queued',
              provider: providerByModel[request.selectedModel],
              model: request.selectedModel,
              mode: request.optimizationMode,
              startedAt: createdAt,
              endedAt: null,
              errorCode: null,
            });

            await tx.runStages.create({
              id: stageId,
              runId,
              stage: 'queued',
              status: 'pending',
              startedAt: createdAt,
              endedAt: null,
              details: {
                source: 'conversation-continue',
                contentLength: request.promptKo.length,
                storedBeforeExecution: true,
              },
            });

            await tx.tasks.updateActivity({
              taskId: task.id,
              updatedAt: createdAt,
              lastActivityAt: createdAt,
            });

            return {
              taskId: task.id,
              conversationId: conversation.id,
              messageId,
              runId,
              acceptedStatus: 'queued' as const,
            };
          });
        }

        const taskId = createId('task');
        const conversationId = createId('conversation');

        await persistence.transaction(async (tx) => {
          await tx.tasks.create({
            id: taskId,
            title: normalizeTitle(request.promptKo),
            status: 'planning',
            projectId: request.projectId ?? null,
            sourceScreen: 'chat',
            usageCategory: request.projectId ? 'project_linked' : 'general',
            createdAt,
            updatedAt: createdAt,
            lastActivityAt: createdAt,
          });

          await tx.conversations.create({
            id: conversationId,
            taskId,
            summary: normalizeSummary(request.promptKo),
            mode: request.optimizationMode,
            selectedModel: request.selectedModel,
            createdAt,
            updatedAt: createdAt,
          });

          await tx.messages.create({
            id: messageId,
            conversationId,
            role: 'user',
            contentKo: request.promptKo,
            runId,
            createdAt,
          });

          await tx.runRecords.create({
            id: runId,
            taskId,
            conversationId,
            messageId,
            status: 'queued',
            provider: providerByModel[request.selectedModel],
            model: request.selectedModel,
            mode: request.optimizationMode,
            startedAt: createdAt,
            endedAt: null,
            errorCode: null,
          });

          await tx.runStages.create({
            id: stageId,
            runId,
            stage: 'queued',
            status: 'pending',
            startedAt: createdAt,
            endedAt: null,
            details: {
              source: 'composer-submit',
              contentLength: request.promptKo.length,
              storedBeforeExecution: true,
            },
          });
        });

        return {
          taskId,
          conversationId,
          messageId,
          runId,
          acceptedStatus: 'queued' as const,
        };
      });

      queueBackgroundOptimization(result.runId);

      return result;
    },

    async retryRun(request) {
      const result = await withChatPersistence(options, async (persistence) => {
        const createdAt = now();
        const nextRunId = createId('run');
        const nextStageId = createId('stage');

        await persistence.transaction(async (tx) => {
          const previousRun = await tx.runRecords.getById(request.runId);

          if (!previousRun) {
            throw new Error('재시도할 실행 기록을 찾을 수 없습니다.');
          }

          if (
            previousRun.status === 'queued' ||
            previousRun.status === 'optimizing' ||
            previousRun.status === 'optimized' ||
            previousRun.status === 'cloud_pending' ||
            previousRun.status === 'restoring'
          ) {
            throw new Error('아직 진행 중인 실행은 다시 시작할 수 없습니다.');
          }

          const sourceMessage = await tx.messages.getById(previousRun.messageId);

          if (!sourceMessage || sourceMessage.contentKo.trim().length === 0) {
            throw new Error('저장된 한국어 원문이 없어 같은 요청으로 재시도할 수 없습니다.');
          }

          await tx.runRecords.create({
            id: nextRunId,
            taskId: previousRun.taskId,
            conversationId: previousRun.conversationId,
            messageId: previousRun.messageId,
            status: 'queued',
            provider: previousRun.provider,
            model: previousRun.model,
            mode: previousRun.mode,
            startedAt: createdAt,
            endedAt: null,
            errorCode: null,
          });

          await tx.runStages.create({
            id: nextStageId,
            runId: nextRunId,
            stage: 'queued',
            status: 'pending',
            startedAt: createdAt,
            endedAt: null,
            details: {
              source: 'retry-run',
              retrySourceRunId: request.runId,
              contentLength: sourceMessage.contentKo.length,
              storedBeforeExecution: true,
            },
          });

          await tx.tasks.updateActivity({
            taskId: previousRun.taskId,
            updatedAt: createdAt,
            lastActivityAt: createdAt,
          });
        });

        return {
          runId: nextRunId,
          acceptedStatus: 'queued' as const,
        };
      });

      queueBackgroundOptimization(result.runId);

      return result;
    },

    async getChatFeed(request) {
      return withChatPersistence(options, async (_persistence, connection) => {
        const taskRows = await listTaskFeedRows(connection);

        if (taskRows.length === 0) {
          return createEmptyChatFeed();
        }

        const items = mapFeedItems(taskRows).filter((item) => item.conversationId.length > 0);
        const activeTaskRow =
          taskRows.find((row) => row.conversation_id === request.conversationId) ?? taskRows[0];

        if (!activeTaskRow.conversation_id) {
          return {
            ...createEmptyChatFeed(),
            items,
          };
        }

        const messages = await listConversationMessages(connection, activeTaskRow.conversation_id);
        const runs = await listConversationRuns(connection, activeTaskRow.conversation_id);
        const activeRun = runs[runs.length - 1] ?? null;

        return {
          activeConversationId: activeTaskRow.conversation_id,
          activeTaskId: activeTaskRow.task_id,
          activeTaskTitle: activeTaskRow.title,
          recommendedPrompts: [...recommendedPrompts],
          items,
          messages,
          runs,
          activeRun,
        };
      });
    },
  };
}
