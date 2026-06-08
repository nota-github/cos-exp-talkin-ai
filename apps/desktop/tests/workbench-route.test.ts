import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import {
  getWorkbenchSurfaceState,
  previewWorkbenchLayout,
} from '../src/renderer/routes/workbench-surface.ts';
import { createPersistentWorkbenchService } from '../src/main/workbench/index.ts';

const workbenchRouteSource = readFileSync(
  new URL('../src/renderer/routes/WorkbenchRoute.tsx', import.meta.url),
  'utf8',
);
const workbenchStylesSource = readFileSync(
  new URL('../src/renderer/styles.css', import.meta.url),
  'utf8',
);

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-workbench-route-'));
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
  const fallback = values[values.length - 1] ?? '2026-06-08T03:00:00.000Z';

  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

test('story-5.2:VAL-1 and story-5.2:AC-1 openInWorkbench keeps the same task and conversation after continuing from chat', async () => {
  const temp = createTempDatabase();

  try {
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: () => '2026-06-08T03:10:00.000Z',
        createId: createDeterministicIdFactory(),
      }),
    });

    const result = await service.commands.submitPrompt({
      promptKo: '한국어 제안서 초안을 이어서 작업대에서 검토하게 연결해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });
    const openResult = await service.commands.openInWorkbench({
      taskId: result.taskId,
    });
    const layout = await service.queries.getWorkbenchLayout({});
    const handle = await openSqliteDatabase(temp.dbPath);

    try {
      const [conversationCountRow] = await handle.connection.query<{ count: number }>(`
        SELECT COUNT(*) AS count
        FROM conversations
        WHERE task_id = '${result.taskId}';
      `);

      assert.equal(conversationCountRow?.count, 1);
    } finally {
      await handle.close();
    }

    assert.equal(openResult.taskId, result.taskId);
    assert.equal(layout.panels.some((panel) => panel.taskId === result.taskId), true);
    assert.equal(layout.recentTasks.filter((task) => task.taskId === result.taskId).length, 1);
  } finally {
    temp.cleanup();
  }
});

test('story-5.2:VAL-2 and story-5.2:AC-2 workbench recent rail is sorted by latest activity and refreshes when activity changes', async () => {
  const service = createDesktopIpcService();

  const initialLayout = await service.queries.getWorkbenchLayout({});
  const initialRecentTaskOrder = initialLayout.recentTasks.map((task) => task.taskId);

  assert.deepEqual(initialRecentTaskOrder, ['task-003', 'task-001', 'task-002']);

  await service.commands.openInWorkbench({
    taskId: 'task-002',
  });

  const refreshedLayout = await service.queries.getWorkbenchLayout({});

  assert.equal(refreshedLayout.recentTasks[0]?.taskId, 'task-002');
  assert.equal(refreshedLayout.activePanelSlot, 'north-east');
  assert.equal(refreshedLayout.recentTasks[0]?.panelSlot, 'north-east');
});

test('story-5.2:VAL-3 and story-5.2:AC-3 repeated open reuses an existing panel instead of duplicating it', async () => {
  const service = createDesktopIpcService();

  const firstOpen = await service.commands.openInWorkbench({
    taskId: 'task-001',
  });
  const secondOpen = await service.commands.openInWorkbench({
    taskId: 'task-001',
    panelSlot: 'south-east',
  });
  const layout = await service.queries.getWorkbenchLayout({});

  assert.equal(firstOpen.panelSlot, 'north-west');
  assert.equal(secondOpen.panelSlot, 'north-west');
  assert.equal(layout.panels.filter((panel) => panel.taskId === 'task-001').length, 1);
});

test('story-5.2:AC-4 and story-5.2:AC-5 selecting a recent task can place it into an empty panel while keeping rail and workspace visually distinct', async () => {
  const service = createDesktopIpcService();

  const openResult = await service.commands.openInWorkbench({
    taskId: 'task-003',
  });
  const layout = await service.queries.getWorkbenchLayout({});

  assert.equal(openResult.panelSlot, 'south-west');
  assert.equal(layout.activePanelSlot, 'south-west');
  assert.equal(layout.panels.find((panel) => panel.slot === 'south-west')?.taskId, 'task-003');
  assert.match(workbenchRouteSource, /desktopClient\.commands\.openInWorkbench/);
  assert.match(workbenchRouteSource, /className="panel workbench-rail"/);
  assert.match(workbenchRouteSource, /className="workbench-stage"/);
  assert.match(workbenchRouteSource, /aria-pressed=\{isTaskActive\}/);
  assert.match(workbenchStylesSource, /\.workbench-rail\s*\{/);
  assert.match(workbenchStylesSource, /\.workbench-panel-active\s*\{/);
});

test('story-5.2:SCOPE-3 desktop loading state with no workbench data does not render preview tasks, panels, or focus', () => {
  const surfaceState = getWorkbenchSurfaceState({
    desktopAvailable: true,
    queryStatus: 'loading',
    layout: null,
    previewLayout: previewWorkbenchLayout,
    activePanelSlot: previewWorkbenchLayout.activePanelSlot,
  });

  assert.equal(surfaceState.showLoadingState, true);
  assert.equal(surfaceState.showInteractiveContent, false);
  assert.equal(surfaceState.activePanelSlot, null);
  assert.equal(surfaceState.activeTaskId, null);
  assert.deepEqual(surfaceState.recentTasks, []);
  assert.deepEqual(surfaceState.panels, []);
  assert.equal(surfaceState.railCountLabel, '동기화 중');
  assert.equal(surfaceState.stageBadgeLabel, '동기화 대기');
});

test('story-5.2:SCOPE-3 desktop error state with no workbench data does not fall back to preview rail or panel content', () => {
  const surfaceState = getWorkbenchSurfaceState({
    desktopAvailable: true,
    queryStatus: 'error',
    layout: null,
    previewLayout: previewWorkbenchLayout,
    activePanelSlot: previewWorkbenchLayout.activePanelSlot,
  });

  assert.equal(surfaceState.showErrorState, true);
  assert.equal(surfaceState.showInteractiveContent, false);
  assert.equal(surfaceState.activePanelSlot, null);
  assert.equal(surfaceState.activeTaskId, null);
  assert.deepEqual(surfaceState.recentTasks, []);
  assert.deepEqual(surfaceState.panels, []);
  assert.equal(surfaceState.railCountLabel, '불러오지 못함');
  assert.equal(surfaceState.stageBadgeLabel, '다시 시도 필요');
});

test('story-5.3:VAL-1, story-5.3:AC-1, and story-5.3:AC-2 workbench shows multiple open panels inside a wide 2x2 grid workspace', async () => {
  const temp = createTempDatabase();

  try {
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T03:20:00.000Z',
          '2026-06-08T03:21:00.000Z',
        ),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T03:22:00.000Z',
          '2026-06-08T03:23:00.000Z',
          '2026-06-08T03:24:00.000Z',
        ),
        createId: idFactory,
      }),
    });

    const firstTask = await service.commands.submitPrompt({
      promptKo: '첫 번째 장기 작업을 작업대에 열어줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });
    const secondTask = await service.commands.submitPrompt({
      promptKo: '두 번째 장기 작업도 별도 패널에 배치해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });

    await service.commands.openInWorkbench({
      taskId: firstTask.taskId,
    });
    await service.commands.openInWorkbench({
      taskId: secondTask.taskId,
    });

    const layout = await service.queries.getWorkbenchLayout({});

    assert.equal(layout.panels.filter((panel) => panel.taskId !== null).length, 2);
    assert.deepEqual(
      layout.panels.map((panel) => panel.slot),
      ['north-west', 'north-east', 'south-west', 'south-east'],
    );
    assert.match(workbenchRouteSource, /desktopClient\.commands\.moveWorkbenchPanel/);
    assert.match(workbenchRouteSource, /desktopClient\.commands\.closeWorkbenchPanel/);
    assert.match(workbenchStylesSource, /\.workbench-grid\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
    assert.match(workbenchStylesSource, /@media \(max-width: 1240px\)[\s\S]*\.workbench-grid,[\s\S]*grid-template-columns: 1fr;/);
  } finally {
    temp.cleanup();
  }
});

test('story-5.3:VAL-2 and story-5.3:AC-3 panel placement persists after moving a task and recreating desktop services', async () => {
  const temp = createTempDatabase();

  try {
    const initialIds = createDeterministicIdFactory();
    const initialService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T03:30:00.000Z',
          '2026-06-08T03:31:00.000Z',
        ),
        createId: initialIds,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T03:32:00.000Z',
          '2026-06-08T03:33:00.000Z',
          '2026-06-08T03:34:00.000Z',
        ),
        createId: initialIds,
      }),
    });

    const firstTask = await initialService.commands.submitPrompt({
      promptKo: '남쪽 패널로 옮길 초안 작업을 만들어줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });
    const secondTask = await initialService.commands.submitPrompt({
      promptKo: '다른 패널을 차지할 비교 작업도 생성해줘.',
      selectedModel: 'gemini-1.5-pro',
      optimizationMode: 'long_context',
    });

    await initialService.commands.openInWorkbench({
      taskId: firstTask.taskId,
    });
    await initialService.commands.openInWorkbench({
      taskId: secondTask.taskId,
    });
    await initialService.commands.moveWorkbenchPanel({
      fromPanelSlot: 'north-west',
      toPanelSlot: 'south-east',
    });

    const beforeRestart = await initialService.queries.getWorkbenchLayout({});

    assert.equal(
      beforeRestart.panels.find((panel) => panel.slot === 'south-east')?.taskId,
      firstTask.taskId,
    );
    assert.equal(
      beforeRestart.recentTasks.find((task) => task.taskId === firstTask.taskId)?.panelSlot,
      'south-east',
    );

    const restartedService = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T03:35:00.000Z'),
        createId: createDeterministicIdFactory(),
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T03:36:00.000Z'),
        createId: createDeterministicIdFactory(),
      }),
    });

    const afterRestart = await restartedService.queries.getWorkbenchLayout({});

    assert.equal(
      afterRestart.panels.find((panel) => panel.slot === 'south-east')?.taskId,
      firstTask.taskId,
    );
    assert.equal(
      afterRestart.panels.find((panel) => panel.slot === 'north-east')?.taskId,
      secondTask.taskId,
    );
    assert.equal(
      afterRestart.recentTasks.find((task) => task.taskId === firstTask.taskId)?.panelSlot,
      'south-east',
    );
  } finally {
    temp.cleanup();
  }
});

test('story-5.3:SCOPE-3 and story-5.3:AC-4 close clears panel assignment while the renderer keeps explicit empty-panel CTA copy', async () => {
  const temp = createTempDatabase();

  try {
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow('2026-06-08T03:40:00.000Z'),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T03:41:00.000Z',
          '2026-06-08T03:42:00.000Z',
        ),
        createId: idFactory,
      }),
    });

    const task = await service.commands.submitPrompt({
      promptKo: '닫기 동작을 확인할 단일 패널 작업입니다.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });

    await service.commands.openInWorkbench({
      taskId: task.taskId,
    });
    await service.commands.closeWorkbenchPanel({
      panelSlot: 'north-west',
    });

    const layout = await service.queries.getWorkbenchLayout({});

    assert.equal(layout.panels.find((panel) => panel.slot === 'north-west')?.taskId, null);
    assert.equal(
      layout.recentTasks.find((recentTask) => recentTask.taskId === task.taskId)?.isOpen,
      false,
    );
    assert.match(workbenchRouteSource, /또는 새 채팅을 열어 병렬 작업을 시작하세요/);
    assert.match(workbenchRouteSource, /desktopClient\.commands\.closeWorkbenchPanel/);
    assert.match(workbenchRouteSource, /desktopClient\.commands\.moveWorkbenchPanel/);
    assert.match(workbenchStylesSource, /\.workbench-panel-toolbar\s*\{/);
  } finally {
    temp.cleanup();
  }
});
