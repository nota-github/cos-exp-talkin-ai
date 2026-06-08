import { randomUUID } from 'node:crypto';
import type {
  CreateProjectCommand,
  CreateProjectResult,
  ProjectDetailQuery,
  ProjectDetailResult,
  ProjectListQuery,
  ProjectListResult,
  SetTaskProjectCommand,
  SetTaskProjectResult,
  UpdateProjectCommand,
  UpdateProjectResult,
} from '../../shared/ipc/contracts';
import {
  createChatRunPersistence,
  type ChatRunPersistence,
  type ChatRunPersistenceScope,
  type ProjectDetailRecord,
  type ProjectListItem,
  type RecentTaskRecord,
} from '../persistence/index.ts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';

export interface ProjectService {
  getProjectList(request: ProjectListQuery): Promise<ProjectListResult>;
  getProjectDetail(request: ProjectDetailQuery): Promise<ProjectDetailResult>;
  createProject(request: CreateProjectCommand): Promise<CreateProjectResult>;
  updateProject(request: UpdateProjectCommand): Promise<UpdateProjectResult>;
  setTaskProject(request: SetTaskProjectCommand): Promise<SetTaskProjectResult>;
}

export type PersistentProjectServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
  createId?: (prefix: string) => string;
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

function getEffectiveProjectActivityAt(updatedAt: string, lastTaskActivityAt: string | null) {
  if (!lastTaskActivityAt) {
    return updatedAt;
  }

  return updatedAt > lastTaskActivityAt ? updatedAt : lastTaskActivityAt;
}

async function withProjectPersistence<TValue>(
  options: PersistentProjectServiceOptions,
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

function mapProjectListItem(nowIso: string, item: ProjectListItem) {
  const lastActivityAt = getEffectiveProjectActivityAt(item.updatedAt, item.lastTaskActivityAt);

  return {
    projectId: item.id,
    name: item.name,
    description: item.description,
    goal: item.goal,
    taskCount: item.taskCount,
    fileCount: item.fileAssetCount,
    updatedAt: item.updatedAt,
    lastActivityAt,
    lastActivity: formatRelativeActivity(nowIso, lastActivityAt),
  };
}

function mapRecentTask(nowIso: string, task: RecentTaskRecord) {
  return {
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    projectId: task.projectId,
    projectName: task.projectName,
    sourceScreen: task.sourceScreen,
    lastActivity: formatRelativeActivity(nowIso, task.lastActivityAt),
    lastActivityAt: task.lastActivityAt,
  };
}

function mapProjectDetail(nowIso: string, record: ProjectDetailRecord): ProjectDetailResult {
  const tasks = record.tasks.map((task) => ({
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    sourceScreen: task.sourceScreen,
    summary: task.summary,
    conversationId: task.conversationId,
    lastActivity: formatRelativeActivity(nowIso, task.lastActivityAt),
    lastActivityAt: task.lastActivityAt,
  }));

  return {
    projectId: record.id,
    name: record.name,
    description: record.description,
    goal: record.goal,
    updatedAt: record.updatedAt,
    files: record.fileAssets.map((file) => ({
      fileId: file.id,
      displayName: file.displayName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
    tasks,
    recentActivity: tasks.slice(0, 4).map((task) => ({
      activityId: `task-${task.taskId}`,
      title: task.title,
      summary:
        task.summary ??
        `${task.sourceScreen} 화면에서 이어진 작업입니다. 한국어 응답과 후속 지시 흐름을 여기서 다시 이어갈 수 있습니다.`,
      timestampLabel: task.lastActivity,
      timestampAt: task.lastActivityAt,
      taskId: task.taskId,
      conversationId: task.conversationId,
    })),
  };
}

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function touchProject(
  scope: Pick<ChatRunPersistenceScope, 'projects'>,
  projectId: string,
  updatedAt: string,
) {
  const project = await scope.projects.getById(projectId);

  if (!project) {
    throw new Error('프로젝트를 찾을 수 없습니다.');
  }

  await scope.projects.update({
    projectId,
    name: project.name,
    description: project.description,
    goal: project.goal,
    updatedAt,
  });
}

export function createPersistentProjectService(
  options: PersistentProjectServiceOptions,
): ProjectService {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? defaultCreateId;

  return {
    async getProjectList(_request) {
      const requestedAt = now();

      return withProjectPersistence(options, async (persistence) => {
        const [projects, recentTasks] = await Promise.all([
          persistence.projects.list(),
          persistence.tasks.listRecent(12),
        ]);

        return {
          projects: projects.map((project) => mapProjectListItem(requestedAt, project)),
          recentTasks: recentTasks.map((task) => mapRecentTask(requestedAt, task)),
        };
      });
    },

    async getProjectDetail(request) {
      const requestedAt = now();

      return withProjectPersistence(options, async (persistence) => {
        const detail = await persistence.projects.getDetail(request.projectId);

        if (!detail) {
          throw new Error('프로젝트를 찾을 수 없습니다.');
        }

        return mapProjectDetail(requestedAt, detail);
      });
    },

    async createProject(request) {
      const createdAt = now();
      const projectId = createId('project');
      const name = request.name.trim();

      if (!name) {
        throw new Error('프로젝트 이름을 입력해 주세요.');
      }

      return withProjectPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          await tx.projects.create({
            id: projectId,
            name,
            description: request.description.trim(),
            goal: request.goal.trim(),
            createdAt,
            updatedAt: createdAt,
          });

          return {
            projectId,
          };
        }),
      );
    },

    async updateProject(request) {
      const updatedAt = now();
      const name = request.name.trim();

      if (!name) {
        throw new Error('프로젝트 이름을 입력해 주세요.');
      }

      return withProjectPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const existing = await tx.projects.getById(request.projectId);

          if (!existing) {
            throw new Error('수정할 프로젝트를 찾을 수 없습니다.');
          }

          await tx.projects.update({
            projectId: request.projectId,
            name,
            description: request.description.trim(),
            goal: request.goal.trim(),
            updatedAt,
          });

          return {
            projectId: request.projectId,
            updatedAt,
          };
        }),
      );
    },

    async setTaskProject(request) {
      const updatedAt = now();

      return withProjectPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const task = await tx.tasks.getById(request.taskId);

          if (!task) {
            throw new Error('연결할 작업을 찾을 수 없습니다.');
          }

          if (request.projectId !== null) {
            const nextProject = await tx.projects.getById(request.projectId);

            if (!nextProject) {
              throw new Error('연결할 프로젝트를 찾을 수 없습니다.');
            }
          }

          const previousProjectId = task.projectId;

          await tx.tasks.updateWorkflow({
            taskId: task.id,
            projectId: request.projectId,
            updatedAt,
            lastActivityAt: updatedAt,
          });

          if (previousProjectId) {
            await touchProject(tx, previousProjectId, updatedAt);
          }

          if (request.projectId && request.projectId !== previousProjectId) {
            await touchProject(tx, request.projectId, updatedAt);
          }

          return {
            taskId: task.id,
            projectId: request.projectId,
            previousProjectId,
          };
        }),
      );
    },
  };
}
