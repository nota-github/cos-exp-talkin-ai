import { randomUUID } from 'node:crypto';
import type {
  CloudModelId,
  CloseWorkbenchPanelCommand,
  CloseWorkbenchPanelResult,
  MoveWorkbenchPanelCommand,
  MoveWorkbenchPanelResult,
  OptimizationMode,
  OpenInWorkbenchCommand,
  OpenInWorkbenchResult,
  PanelSlot,
  TaskStatus,
  WorkbenchLayoutQuery,
  WorkbenchLayoutResult,
  WorkbenchPanel,
  WorkbenchRecentTask,
} from '../../shared/ipc/contracts';
import {
  compareWorkbenchPanelSlots,
  resolveWorkbenchPanelSlot,
  workbenchPanelSlots,
} from '../../shared/ipc/workbench.ts';
import {
  createChatRunPersistence,
  type ChatRunPersistence,
  type ChatRunPersistenceScope,
  type WorkbenchLayoutRecord,
  type WorkbenchPanelRecord,
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
} from '../chat/feed-projection.ts';

type WorkbenchTaskRow = {
  task_id: string;
  title: string;
  status: TaskStatus;
  project_name: string | null;
  last_activity_at: string;
  conversation_id: string | null;
  selected_model: CloudModelId | null;
  mode: OptimizationMode | null;
  baseline_input_tokens: number | null;
  optimized_input_tokens: number | null;
};

export interface WorkbenchService {
  getWorkbenchLayout(request: WorkbenchLayoutQuery): Promise<WorkbenchLayoutResult>;
  openInWorkbench(request: OpenInWorkbenchCommand): Promise<OpenInWorkbenchResult>;
  moveWorkbenchPanel(request: MoveWorkbenchPanelCommand): Promise<MoveWorkbenchPanelResult>;
  closeWorkbenchPanel(request: CloseWorkbenchPanelCommand): Promise<CloseWorkbenchPanelResult>;
}

export type PersistentWorkbenchServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
  createId?: (prefix: string) => string;
};

const defaultWorkbenchLayoutId = 'layout-primary';
const defaultWorkbenchLayoutName = '기본 작업대';

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

function shiftIsoTimestamp(iso: string, deltaMs: number) {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

function computeSavingsRate(
  baselineInputTokens: number | null,
  optimizedInputTokens: number | null,
) {
  if (!baselineInputTokens || baselineInputTokens <= 0 || optimizedInputTokens === null) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((1 - optimizedInputTokens / baselineInputTokens) * 100),
  );
}

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

function getMaxUpdatedAt(layout: WorkbenchLayoutRecord, panels: WorkbenchPanelRecord[]) {
  return panels.reduce(
    (latest, panel) => (panel.updatedAt.localeCompare(latest) > 0 ? panel.updatedAt : latest),
    layout.updatedAt,
  );
}

function getActivePanelSlot(panels: WorkbenchPanelRecord[]): PanelSlot | null {
  const activePanel = [...panels]
    .filter((panel) => panel.taskId !== null)
    .sort((left, right) => {
      const updatedAtCompare = right.updatedAt.localeCompare(left.updatedAt);

      if (updatedAtCompare !== 0) {
        return updatedAtCompare;
      }

      return compareWorkbenchPanelSlots(left.panelSlot, right.panelSlot);
    })[0];

  return activePanel?.panelSlot ?? null;
}

function getPanelSlotsForResolution(panels: WorkbenchPanelRecord[]): WorkbenchPanel[] {
  const panelBySlot = new Map(panels.map((panel) => [panel.panelSlot, panel]));

  return workbenchPanelSlots.map((slot) => ({
    slot,
    taskId: panelBySlot.get(slot)?.taskId ?? null,
    title: '',
    status: 'idle',
    note: '',
    conversation: null,
  }));
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

function buildEmptyPanel(slot: PanelSlot): WorkbenchPanel {
  const titleBySlot: Record<PanelSlot, string> = {
    'north-west': '작업을 끌어오세요',
    'north-east': '새 채팅을 열어보세요',
    'south-west': '다른 작업을 병렬로 두세요',
    'south-east': '빈 슬롯을 유지해도 됩니다',
  };
  const noteBySlot: Record<PanelSlot, string> = {
    'north-west': '최근 작업 레일에서 원하는 task를 선택해 독립 패널로 여세요',
    'north-east': '새 채팅이나 최근 task를 이 슬롯에 배치할 수 있습니다',
    'south-west': '리서치, 초안, 검토 작업을 서로 다른 패널로 분리하세요',
    'south-east': '필요할 때 바로 이어 붙일 수 있도록 비워 둔 작업 공간입니다',
  };

  return {
    slot,
    taskId: null,
    title: titleBySlot[slot],
    status: 'idle',
    note: noteBySlot[slot],
    conversation: null,
  };
}

async function listWorkbenchTaskRows(
  connection: SqliteConnection,
): Promise<WorkbenchTaskRow[]> {
  return connection.query<WorkbenchTaskRow>(`
    SELECT
      tasks.id AS task_id,
      tasks.title AS title,
      tasks.status AS status,
      projects.name AS project_name,
      tasks.last_activity_at AS last_activity_at,
      conversations.id AS conversation_id,
      conversations.selected_model AS selected_model,
      conversations.mode AS mode,
      (
        SELECT usage_records.baseline_input_tokens
        FROM usage_records
        INNER JOIN run_records
          ON run_records.id = usage_records.run_id
        WHERE run_records.task_id = tasks.id
        ORDER BY COALESCE(run_records.ended_at, run_records.started_at) DESC, usage_records.rowid DESC
        LIMIT 1
      ) AS baseline_input_tokens,
      (
        SELECT usage_records.optimized_input_tokens
        FROM usage_records
        INNER JOIN run_records
          ON run_records.id = usage_records.run_id
        WHERE run_records.task_id = tasks.id
        ORDER BY COALESCE(run_records.ended_at, run_records.started_at) DESC, usage_records.rowid DESC
        LIMIT 1
      ) AS optimized_input_tokens
    FROM tasks
    LEFT JOIN projects
      ON projects.id = tasks.project_id
    LEFT JOIN conversations
      ON conversations.id = (
        SELECT candidate.id
        FROM conversations AS candidate
        WHERE candidate.task_id = tasks.id
        ORDER BY candidate.created_at DESC, candidate.rowid DESC
        LIMIT 1
      )
    ORDER BY tasks.last_activity_at DESC, tasks.updated_at DESC;
  `);
}

async function ensureWorkbenchLayout(
  scope: Pick<ChatRunPersistenceScope, 'workbenchLayouts'>,
  layoutId: string,
  createdAt: string,
) {
  const existingLayout = await scope.workbenchLayouts.getById(layoutId);

  if (existingLayout) {
    return existingLayout;
  }

  return scope.workbenchLayouts.create({
    id: layoutId,
    name: defaultWorkbenchLayoutName,
    createdAt,
    updatedAt: createdAt,
  });
}

function buildWorkbenchLayoutResult(options: {
  layout: WorkbenchLayoutRecord;
  panels: WorkbenchPanelRecord[];
  taskRows: WorkbenchTaskRow[];
  nowIso: string;
  connection: SqliteConnection;
}): Promise<WorkbenchLayoutResult> {
  const panelBySlot = new Map(options.panels.map((panel) => [panel.panelSlot, panel]));
  const openTaskById = new Map(
    options.panels
      .filter((panel) => panel.taskId !== null)
      .map((panel) => [panel.taskId as string, panel.panelSlot]),
  );
  const taskRowById = new Map(options.taskRows.map((task) => [task.task_id, task]));

  const recentTasks: WorkbenchRecentTask[] = options.taskRows.map((task) => {
    const panelSlot = openTaskById.get(task.task_id) ?? null;

    return {
      taskId: task.task_id,
      title: task.title,
      projectName: task.project_name ?? '개인 작업',
      status: task.status,
      lastActivity: formatRelativeActivity(options.nowIso, task.last_activity_at),
      lastActivityAt: task.last_activity_at,
      toolSummary: buildToolSummary(task.selected_model, task.mode),
      savingsRate: computeSavingsRate(
        task.baseline_input_tokens,
        task.optimized_input_tokens,
      ),
      panelSlot,
      isOpen: panelSlot !== null,
    };
  });

  return Promise.all(
    workbenchPanelSlots.map(async (slot) => {
      const panelRecord = panelBySlot.get(slot);

      if (!panelRecord || !panelRecord.taskId) {
        return buildEmptyPanel(slot);
      }

      const task = taskRowById.get(panelRecord.taskId);

      if (!task) {
        return buildEmptyPanel(slot);
      }

      const conversation =
        task.conversation_id === null
          ? null
          : {
              conversationId: task.conversation_id,
              messages: await listConversationMessages(options.connection, task.conversation_id),
              runs: await listConversationRuns(options.connection, task.conversation_id),
              activeRun: null,
            };

      if (conversation) {
        conversation.activeRun = conversation.runs[conversation.runs.length - 1] ?? null;
      }

      return {
        slot,
        taskId: task.task_id,
        title: task.title,
        status: task.status,
        note: `${task.project_name ?? '개인 작업'} · ${buildToolSummary(
          task.selected_model,
          task.mode,
        )}`,
        conversation,
      } satisfies WorkbenchPanel;
    }),
  ).then((stagePanels) => ({
    layoutId: options.layout.id,
    updatedAt: getMaxUpdatedAt(options.layout, options.panels),
    activePanelSlot: getActivePanelSlot(options.panels),
    recentTasks,
    panels: stagePanels,
  }));
}

async function readWorkbenchLayout(
  persistence: ChatRunPersistence,
  connection: SqliteConnection,
  layoutId: string,
  nowIso: string,
) {
  const layout = await ensureWorkbenchLayout(persistence, layoutId, nowIso);
  const [panels, taskRows] = await Promise.all([
    persistence.workbenchPanels.listByLayout(layout.id),
    listWorkbenchTaskRows(connection),
  ]);

  return buildWorkbenchLayoutResult({
    layout,
    panels,
    taskRows,
    nowIso,
    connection,
  });
}

async function withWorkbenchPersistence<TValue>(
  options: PersistentWorkbenchServiceOptions,
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

export function createPersistentWorkbenchService(
  options: PersistentWorkbenchServiceOptions,
): WorkbenchService {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? ((prefix: string) => `${prefix}-${randomUUID()}`);

  return {
    async getWorkbenchLayout(request) {
      const layoutId = request.layoutId ?? defaultWorkbenchLayoutId;
      const requestedAt = now();

      return withWorkbenchPersistence(options, async (persistence, connection) =>
        readWorkbenchLayout(persistence, connection, layoutId, requestedAt),
      );
    },

    async openInWorkbench(request) {
      const updatedAt = now();

      return withWorkbenchPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const task = await tx.tasks.getById(request.taskId);

          if (!task) {
            throw new Error('작업대에 열 task를 찾을 수 없습니다.');
          }

          const layout = await ensureWorkbenchLayout(
            tx,
            defaultWorkbenchLayoutId,
            updatedAt,
          );
          const panels = await tx.workbenchPanels.listByLayout(layout.id);
          const slot = resolveWorkbenchPanelSlot({
            panels: getPanelSlotsForResolution(panels),
            taskId: task.id,
            requestedPanelSlot: request.panelSlot,
          });
          const existingPanel = panels.find((panel) => panel.panelSlot === slot);

          await tx.workbenchPanels.save({
            id: existingPanel?.id ?? createId('panel'),
            layoutId: layout.id,
            panelSlot: slot,
            taskId: task.id,
            pinned: true,
            updatedAt,
          });
          await tx.tasks.updateActivity({
            taskId: task.id,
            updatedAt,
            lastActivityAt: updatedAt,
          });

          return {
            layoutId: layout.id,
            taskId: task.id,
            panelSlot: slot,
          };
        }),
      );
    },

    async moveWorkbenchPanel(request) {
      if (request.fromPanelSlot === request.toPanelSlot) {
        const layoutId = defaultWorkbenchLayoutId;

        return withWorkbenchPersistence(options, async (persistence) => {
          const layout = await ensureWorkbenchLayout(persistence, layoutId, now());
          const panels = await persistence.workbenchPanels.listByLayout(layout.id);
          const sourcePanel = panels.find(
            (panel) => panel.panelSlot === request.fromPanelSlot,
          );

          if (!sourcePanel?.taskId) {
            throw new Error('이동할 패널 작업이 없습니다.');
          }

          return {
            layoutId: layout.id,
            taskId: sourcePanel.taskId,
            panelSlot: request.toPanelSlot,
          };
        });
      }

      const updatedAt = now();

      return withWorkbenchPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const layout = await ensureWorkbenchLayout(
            tx,
            defaultWorkbenchLayoutId,
            updatedAt,
          );
          const panels = await tx.workbenchPanels.listByLayout(layout.id);
          const sourcePanel = panels.find(
            (panel) => panel.panelSlot === request.fromPanelSlot,
          );
          const targetPanel = panels.find(
            (panel) => panel.panelSlot === request.toPanelSlot,
          );

          if (!sourcePanel?.taskId) {
            throw new Error('이동할 패널 작업이 없습니다.');
          }

          const swappedTaskId = targetPanel?.taskId ?? null;

          await tx.workbenchPanels.save({
            id: sourcePanel.id,
            layoutId: layout.id,
            panelSlot: request.fromPanelSlot,
            taskId: swappedTaskId,
            pinned: swappedTaskId !== null,
            updatedAt: swappedTaskId !== null ? shiftIsoTimestamp(updatedAt, -1) : updatedAt,
          });
          await tx.workbenchPanels.save({
            id: targetPanel?.id ?? createId('panel'),
            layoutId: layout.id,
            panelSlot: request.toPanelSlot,
            taskId: sourcePanel.taskId,
            pinned: true,
            updatedAt,
          });

          return {
            layoutId: layout.id,
            taskId: sourcePanel.taskId,
            panelSlot: request.toPanelSlot,
          };
        }),
      );
    },

    async closeWorkbenchPanel(request) {
      const updatedAt = now();

      return withWorkbenchPersistence(options, async (persistence) =>
        persistence.transaction(async (tx) => {
          const layout = await ensureWorkbenchLayout(
            tx,
            defaultWorkbenchLayoutId,
            updatedAt,
          );
          const panels = await tx.workbenchPanels.listByLayout(layout.id);
          const targetPanel = panels.find(
            (panel) => panel.panelSlot === request.panelSlot,
          );

          if (targetPanel) {
            await tx.workbenchPanels.save({
              id: targetPanel.id,
              layoutId: layout.id,
              panelSlot: targetPanel.panelSlot,
              taskId: null,
              pinned: false,
              updatedAt,
            });
          }

          const nextPanels = targetPanel
            ? panels.map((panel) =>
                panel.panelSlot === targetPanel.panelSlot
                  ? {
                      ...panel,
                      taskId: null,
                      pinned: false,
                      updatedAt,
                    }
                  : panel,
              )
            : panels;

          return {
            layoutId: layout.id,
            panelSlot: request.panelSlot,
            closedTaskId: targetPanel?.taskId ?? null,
            activePanelSlot: getActivePanelSlot(nextPanels),
          };
        }),
      );
    },
  };
}
