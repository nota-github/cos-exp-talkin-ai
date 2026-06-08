import { randomUUID } from 'node:crypto';
import type {
  ChatFeedItem,
  ChatFeedMessage,
  ChatFeedQuery,
  ChatFeedResult,
  ChatFeedRunSummary,
  CloudModelId,
  OptimizationMode,
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

type MessageRow = {
  id: string;
  conversation_id: string;
  role: ChatFeedMessage['role'];
  content_ko: string;
  run_id: string | null;
  created_at: string;
};

type RunRow = {
  id: string;
  status: ChatFeedRunSummary['status'];
  model: CloudModelId;
  mode: OptimizationMode;
};

type RunStageRow = {
  stage: Exclude<ChatFeedRunSummary['stage'], null>;
};

export interface ChatHistoryService {
  submitPrompt(request: SubmitPromptCommand): Promise<SubmitPromptResult>;
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

async function listConversationMessages(
  connection: SqliteConnection,
  conversationId: string,
) {
  return connection.query<MessageRow>(`
    SELECT
      id,
      conversation_id,
      role,
      content_ko,
      run_id,
      created_at
    FROM messages
    WHERE conversation_id = ${sqlValue(conversationId)}
    ORDER BY created_at ASC;
  `);
}

async function getLatestRun(
  connection: SqliteConnection,
  conversationId: string,
): Promise<ChatFeedRunSummary | null> {
  const runRows = await connection.query<RunRow>(`
    SELECT
      id,
      status,
      model,
      mode
    FROM run_records
    WHERE conversation_id = ${sqlValue(conversationId)}
    ORDER BY started_at DESC
    LIMIT 1;
  `);
  const run = runRows[0];

  if (!run) {
    return null;
  }

  const stageRows = await connection.query<RunStageRow>(`
    SELECT stage
    FROM run_stages
    WHERE run_id = ${sqlValue(run.id)}
    ORDER BY started_at DESC
    LIMIT 1;
  `);

  return {
    runId: run.id,
    status: run.status,
    stage: stageRows[0]?.stage ?? null,
    model: run.model,
    mode: run.mode,
  };
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

function mapFeedMessages(rows: MessageRow[]): ChatFeedMessage[] {
  return rows.map((row) => ({
    messageId: row.id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    role: row.role,
    contentKo: row.content_ko,
    createdAt: row.created_at,
  }));
}

export function createPersistentChatHistoryService(
  options: PersistentChatHistoryServiceOptions,
): ChatHistoryService {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);

  return {
    async submitPrompt(request) {
      const result = await withChatPersistence(options, async (persistence) => {
        const createdAt = now();
        const taskId = createId('task');
        const conversationId = createId('conversation');
        const messageId = createId('message');
        const runId = createId('run');
        const stageId = createId('stage');

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

      if (options.optimizationStageOrchestrator) {
        void Promise.resolve()
          .then(() =>
            options.optimizationStageOrchestrator?.optimizeQueuedRun({
              runId: result.runId,
            }),
          )
          .catch((error) => {
            options.onBackgroundWorkflowError?.({
              operation: 'optimizeQueuedRun',
              runId: result.runId,
              error,
            });
          });
      }

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

        const messageRows = await listConversationMessages(connection, activeTaskRow.conversation_id);
        const activeRun = await getLatestRun(connection, activeTaskRow.conversation_id);

        return {
          activeConversationId: activeTaskRow.conversation_id,
          activeTaskId: activeTaskRow.task_id,
          activeTaskTitle: activeTaskRow.title,
          recommendedPrompts: [...recommendedPrompts],
          items,
          messages: mapFeedMessages(messageRows),
          activeRun,
        };
      });
    },
  };
}
