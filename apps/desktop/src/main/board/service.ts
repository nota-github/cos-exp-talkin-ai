import type {
  BoardColumnsQuery,
  BoardColumnsResult,
  CloudModelId,
  MoveTaskStatusCommand,
  MoveTaskStatusResult,
  OptimizationMode,
  TaskStatus,
} from '../../shared/ipc/contracts';
import { createChatRunPersistence, type ChatRunPersistence } from '../persistence/index.ts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';

export interface BoardService {
  getBoardColumns(request: BoardColumnsQuery): Promise<BoardColumnsResult>;
  moveTaskStatus(request: MoveTaskStatusCommand): Promise<MoveTaskStatusResult>;
}

export type PersistentBoardServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
  createId?: (prefix: string) => string;
};

const boardColumnTitles: Record<TaskStatus, string> = {
  planning: '기획',
  in_progress: '진행 중',
  ai_review: 'AI 검토',
  human_review: '사람 검토',
  completed: '완료',
};

const modelLabels: Record<CloudModelId, string> = {
  'gpt-4.1': 'GPT-4.1',
  'claude-sonnet-4': 'Claude Sonnet',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
};

const modeLabels: Record<OptimizationMode, string> = {
  balanced: '기본',
  savings: '절감 우선',
  quality: '품질 우선',
  long_context: '긴 컨텍스트',
};

function formatRelativeActivity(nowIso: string, activityAt: string) {
  const diffMs = Math.max(0, new Date(nowIso).getTime() - new Date(activityAt).getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return '방금';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}일 전`;
  }

  const [year, month, day] = activityAt.slice(0, 10).split('-');
  return `${year}.${month}.${day}`;
}

function buildToolSummary(
  selectedModel: CloudModelId | null,
  mode: OptimizationMode | null,
) {
  if (!selectedModel || !mode) {
    return '모델 선택 전 · 기본';
  }

  return `${modelLabels[selectedModel]} · ${modeLabels[mode]}`;
}

async function withBoardPersistence<TValue>(
  options: PersistentBoardServiceOptions,
  work: (
    persistence: ChatRunPersistence,
    connection: SqliteConnection,
  ) => Promise<TValue>,
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

export function createPersistentBoardService(
  options: PersistentBoardServiceOptions,
): BoardService {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async getBoardColumns(_request) {
      const requestedAt = now();

      return withBoardPersistence(options, async (persistence) => {
        const columns = await persistence.board.getColumns();

        return {
          columns: columns.map((column) => ({
            status: column.status,
            title: boardColumnTitles[column.status],
            cards: column.cards.map((card) => ({
              taskId: card.taskId,
              conversationId: card.conversationId,
              title: card.title,
              status: card.status,
              projectName: card.projectName ?? '프로젝트 미지정',
              lastActivity: formatRelativeActivity(requestedAt, card.lastActivityAt),
              lastActivityAt: card.lastActivityAt,
              toolSummary: buildToolSummary(card.selectedModel, card.mode),
            })),
          })),
        };
      });
    },

    async moveTaskStatus(request) {
      const updatedAt = now();

      return withBoardPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const task = await tx.tasks.getById(request.taskId);

          if (!task) {
            throw new Error('상태를 바꿀 작업을 찾을 수 없습니다.');
          }

          await tx.tasks.updateWorkflow({
            taskId: task.id,
            status: request.status,
            updatedAt,
            lastActivityAt: updatedAt,
          });

          return {
            taskId: task.id,
            status: request.status,
          };
        }),
      );
    },
  };
}
