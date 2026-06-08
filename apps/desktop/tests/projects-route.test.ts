import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentBoardService } from '../src/main/board/index.ts';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { createChatRunPersistence, migrateDesktopSchema } from '../src/main/persistence/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import {
  getBoardSurfaceState,
  openBoardTaskInChat,
  openBoardTaskInWorkbench,
  previewBoardColumns,
} from '../src/renderer/routes/projects-surface.ts';
import { createPersistentWorkbenchService } from '../src/main/workbench/index.ts';

const projectsRouteSource = readFileSync(
  new URL('../src/renderer/routes/ProjectsRoute.tsx', import.meta.url),
  'utf8',
);
const projectsSurfaceSource = readFileSync(
  new URL('../src/renderer/routes/projects-surface.ts', import.meta.url),
  'utf8',
);
const projectsStylesSource = readFileSync(
  new URL('../src/renderer/styles.css', import.meta.url),
  'utf8',
);

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-projects-route-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  return {
    dbPath,
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createDeterministicIdFactory() {
  const counts = new Map<string, number>();

  return (prefix: string) => {
    const nextValue = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, nextValue);
    return `${prefix}-${String(nextValue).padStart(3, '0')}`;
  };
}

function createSequenceNow(...values: string[]) {
  let index = 0;
  const fallback = values[values.length - 1] ?? '2026-06-08T05:00:00.000Z';

  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

async function seedProject(dbPath: string) {
  const handle = await openSqliteDatabase(dbPath);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await migrateDesktopSchema(handle.connection);
    await persistence.projects.create({
      id: 'project-001',
      name: '사업계획서',
      description: '칸반 상태 동기화 확인용 프로젝트',
      goal: '같은 task가 board, chat, workbench에서 같은 상태를 보이는지 확인',
      createdAt: '2026-06-08T05:00:00.000Z',
      updatedAt: '2026-06-08T05:00:00.000Z',
    });
  } finally {
    await persistence.close();
  }
}

test('story-5.5:VAL-1, story-5.5:AC-1, story-5.5:AC-2, and story-5.5:AC-3 moveTaskStatus keeps board, DB, chat, and workbench in sync through canonical task state', async () => {
  const temp = createTempDatabase();

  try {
    await seedProject(temp.dbPath);
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      boardService: createPersistentBoardService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T05:02:00.000Z',
          '2026-06-08T05:04:00.000Z',
          '2026-06-08T05:05:00.000Z',
        ),
      }),
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:01:00.000Z'),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T05:03:00.000Z', '2026-06-08T05:06:00.000Z'),
        createId: idFactory,
      }),
    });

    const submitResult = await service.commands.submitPrompt({
      promptKo: '파트너 제안서 초안을 칸반으로 관리할 수 있게 만들어줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
      projectId: 'project-001',
    });
    await service.commands.openInWorkbench({
      taskId: submitResult.taskId,
    });

    const initialBoard = await service.queries.getBoardColumns({});
    const initialCard =
      initialBoard.columns.find((column) => column.status === 'planning')?.cards.find(
        (card) => card.taskId === submitResult.taskId,
      ) ?? null;

    assert.equal(initialBoard.columns.length, 5);
    assert.equal(initialCard?.projectName, '사업계획서');
    assert.equal(initialCard?.status, 'planning');
    assert.equal(initialCard?.conversationId, submitResult.conversationId);
    assert.equal(initialCard?.toolSummary, 'Claude Sonnet · 품질 우선');
    assert.equal(typeof initialCard?.lastActivity, 'string');

    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const [beforeTaskRow] = await handle.connection.query<{ status: string }>(`
        SELECT status
        FROM tasks
        WHERE id = '${submitResult.taskId}';
      `);
      const [beforeConversationCount] = await handle.connection.query<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM conversations
        WHERE task_id = '${submitResult.taskId}';
      `);
      const [beforeRunCount] = await handle.connection.query<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM run_records
        WHERE task_id = '${submitResult.taskId}';
      `);

      assert.equal(beforeTaskRow?.status, 'planning');
      assert.equal(beforeConversationCount?.count, 1);
      assert.equal(beforeRunCount?.count, 1);

      await service.commands.moveTaskStatus({
        taskId: submitResult.taskId,
        status: 'ai_review',
      });

      const updatedBoard = await service.queries.getBoardColumns({});
      const updatedCard =
        updatedBoard.columns.find((column) => column.status === 'ai_review')?.cards.find(
          (card) => card.taskId === submitResult.taskId,
        ) ?? null;
      const workbenchLayout = await service.queries.getWorkbenchLayout({});
      const chatFeed = await service.queries.getChatFeed({
        conversationId: submitResult.conversationId,
      });

      const [afterTaskRow] = await handle.connection.query<{ status: string }>(`
        SELECT status
        FROM tasks
        WHERE id = '${submitResult.taskId}';
      `);
      const [afterConversationCount] = await handle.connection.query<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM conversations
        WHERE task_id = '${submitResult.taskId}';
      `);
      const [afterRunCount] = await handle.connection.query<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM run_records
        WHERE task_id = '${submitResult.taskId}';
      `);

      assert.equal(afterTaskRow?.status, 'ai_review');
      assert.equal(afterConversationCount?.count, 1);
      assert.equal(afterRunCount?.count, 1);
      assert.equal(
        updatedBoard.columns.find((column) => column.status === 'planning')?.cards.some(
          (card) => card.taskId === submitResult.taskId,
        ),
        false,
      );
      assert.equal(updatedCard?.status, 'ai_review');
      assert.equal(updatedCard?.projectName, '사업계획서');
      assert.equal(
        workbenchLayout.panels.find((panel) => panel.taskId === submitResult.taskId)?.status,
        'ai_review',
      );
      assert.equal(
        chatFeed.items.find((item) => item.taskId === submitResult.taskId)?.status,
        'ai_review',
      );
    } finally {
      await handle.close();
    }
  } finally {
    temp.cleanup();
  }
});

test('story-5.5:VAL-2 and story-5.5:AC-4 kanban card actions can open the same task in workbench or detailed chat', async () => {
  let workbenchPath = '';
  let observedWorkbenchTaskId: string | null = null;

  const openedWorkbench = await openBoardTaskInWorkbench({
    desktopAvailable: true,
    taskId: 'task-201',
    navigate: (path) => {
      workbenchPath = path;
    },
    openInWorkbench: async (request) => {
      observedWorkbenchTaskId = request.taskId;

      return {
        layoutId: 'layout-primary',
        taskId: request.taskId,
        panelSlot: 'north-west',
      };
    },
  });

  let chatPath = '';
  const openedChat = openBoardTaskInChat({
    conversationId: 'conversation-201',
    navigate: (path) => {
      chatPath = path;
    },
  });

  assert.equal(openedWorkbench, true);
  assert.equal(observedWorkbenchTaskId, 'task-201');
  assert.equal(workbenchPath, '/workbench');
  assert.equal(openedChat, true);
  assert.equal(chatPath, '/?conversationId=conversation-201');
  assert.match(projectsRouteSource, /desktopClient\.commands\.moveTaskStatus/);
  assert.match(projectsRouteSource, /desktopClient\.commands\.openInWorkbench/);
  assert.match(projectsSurfaceSource, /conversationId=/);
});

test('story-5.5:VAL-3, story-5.5:AC-5, and story-5.5:AC-6 board surface distinguishes loading, empty, and populated workflow states', () => {
  const idleState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'idle',
    boardColumns: null,
  });
  const loadingState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'loading',
    boardColumns: null,
  });
  const emptyState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    boardColumns: {
      columns: previewBoardColumns.columns.map((column) => ({
        ...column,
        cards: [],
      })),
    },
  });
  const populatedState = getBoardSurfaceState({
    desktopAvailable: true,
    queryStatus: 'success',
    boardColumns: previewBoardColumns,
  });

  assert.equal(idleState.showLoadingState, true);
  assert.equal(idleState.showInteractiveContent, false);
  assert.equal(idleState.previewMode, false);
  assert.equal(idleState.totalTaskCount, 0);
  assert.equal(idleState.activeTaskCount, 0);
  assert.equal(idleState.completedTaskCount, 0);
  assert.equal(idleState.emptyColumnCount, 5);
  assert.equal(idleState.columns.every((column) => column.cards.length === 0), true);
  assert.equal(loadingState.showLoadingState, true);
  assert.equal(loadingState.showInteractiveContent, false);
  assert.equal(loadingState.totalTaskCount, 0);
  assert.equal(emptyState.showInteractiveContent, true);
  assert.equal(emptyState.totalTaskCount, 0);
  assert.equal(emptyState.emptyColumnCount, 5);
  assert.equal(populatedState.showInteractiveContent, true);
  assert.equal(populatedState.totalTaskCount, 4);
  assert.equal(populatedState.emptyColumnCount, 1);
  assert.match(projectsRouteSource, /관리 화면입니다/);
  assert.match(projectsRouteSource, /아직 이 단계의 작업이 없습니다/);
  assert.match(projectsRouteSource, /className="board-grid"/);
  assert.match(projectsStylesSource, /\.board-grid\s*\{/);
  assert.match(projectsStylesSource, /\.board-card\s*\{/);
  assert.match(projectsStylesSource, /\.board-column-empty\s*\{/);
});
