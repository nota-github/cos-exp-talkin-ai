import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import { getSafeDesktopErrorCopy } from '../src/renderer/lib/ipc/error-copy.ts';
import {
  createWorkbenchComposerState,
  getWorkbenchSurfaceState,
  mergeWorkbenchPanelMessages,
  previewWorkbenchLayout,
  workbenchComposerReducer,
  workbenchSurfaceCopy,
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

async function markRunCompleted(dbPath: string, runId: string, completedAt: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    await handle.connection.exec(`
      UPDATE run_records
      SET status = 'completed',
          ended_at = '${completedAt}',
          error_code = NULL
      WHERE id = '${runId}';
    `);
    await handle.connection.exec(`
      INSERT INTO run_stages (
        id,
        run_id,
        stage,
        status,
        started_at,
        ended_at,
        details_json
      ) VALUES (
        'stage-${runId}',
        '${runId}',
        'completed',
        'completed',
        '${completedAt}',
        '${completedAt}',
        '{"source":"test-complete"}'
      );
    `);
  } finally {
    await handle.close();
  }
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

test('story-6.4:VAL-3 and story-6.4:AC-4 cached workbench data stays visible while surfacing an explicit sync warning', () => {
  const surfaceState = getWorkbenchSurfaceState({
    desktopAvailable: true,
    queryStatus: 'error',
    layout: previewWorkbenchLayout,
    previewLayout: previewWorkbenchLayout,
    activePanelSlot: previewWorkbenchLayout.activePanelSlot,
  });

  assert.equal(surfaceState.showLoadingState, false);
  assert.equal(surfaceState.showErrorState, false);
  assert.equal(surfaceState.showSyncWarningState, true);
  assert.equal(surfaceState.showInteractiveContent, true);
  assert.equal(surfaceState.recentTasks.length, previewWorkbenchLayout.recentTasks.length);
  assert.equal(surfaceState.panels.length, previewWorkbenchLayout.panels.length);
  assert.equal(surfaceState.railCountLabel, '최근 값 유지 중');
  assert.equal(surfaceState.stageBadgeLabel, '재동기화 필요');
  assert.match(workbenchRouteSource, /<span className="screen-kicker">작업대<\/span>/);
  assert.match(workbenchRouteSource, /<span className="panel-kicker">최근 작업<\/span>/);
  assert.match(workbenchRouteSource, /<span className="panel-kicker">불러오는 중<\/span>/);
  assert.match(workbenchRouteSource, /<span className="panel-kicker">다시 확인 필요<\/span>/);
  assert.match(workbenchRouteSource, /<span className="panel-kicker">비어 있음<\/span>/);
  assert.match(workbenchRouteSource, /<span className="panel-kicker">대화 공간<\/span>/);
  assert.match(workbenchRouteSource, /'같은 작업 이어짐'/);
  assert.match(workbenchRouteSource, /surfaceState\.showSyncWarningState/);
  assert.match(workbenchRouteSource, /refreshWorkbenchLayout/);
  assert.match(workbenchRouteSource, /<QueryDiagnostic diagnostic=\{workbenchErrorCopy\.diagnostic\} \/>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="screen-kicker">Workbench<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Recent Tasks<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Loading<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Retry Safe<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Empty<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Workspace<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="panel-kicker">Conversation<\/span>/);
  assert.doesNotMatch(workbenchRouteSource, /대화 ID \$\{panel\.conversation\.conversationId\}/);
  assert.doesNotMatch(workbenchRouteSource, /<span className="badge badge-muted">\s*\{panel\.conversation\s*\?\s*`[^`]*conversationId/);
  assert.doesNotMatch(workbenchRouteSource, /workbenchLayoutQuery\.error\.message/);
  assert.equal(workbenchSurfaceCopy.railSyncWarningTitle, '마지막으로 동기화된 작업대를 보여주고 있습니다');
  assert.equal(workbenchSurfaceCopy.railSyncWarningAction, '작업대 다시 동기화');
  assert.equal(workbenchSurfaceCopy.intro.includes('task'), false);
  assert.equal(workbenchSurfaceCopy.railDescription.includes('task'), false);
  assert.equal(workbenchSurfaceCopy.railLoadingBody.includes('source of truth'), false);
  assert.equal(workbenchSurfaceCopy.panelComposerBody.includes('conversation'), false);
});

test('story-6.4 patch maps technical desktop errors to Korean-first copy while keeping diagnostics non-primary', () => {
  const bridgeUnavailable = getSafeDesktopErrorCopy(
    new Error('Talkin AI desktop bridge is unavailable. Cannot access queries in this renderer context.'),
    '기본 안내',
  );
  const unknownProject = getSafeDesktopErrorCopy(
    new Error('Unknown project: project-001'),
    '기본 안내',
  );
  const genericFailure = getSafeDesktopErrorCopy(
    new Error('Temporary database mismatch'),
    '기본 안내',
  );

  assert.equal(
    bridgeUnavailable.primary,
    '데스크탑 연결이 아직 준비되지 않았습니다. 앱 창을 다시 열거나 잠시 후 다시 시도해 주세요.',
  );
  assert.equal(
    unknownProject.primary,
    '방금 보던 작업 정보를 다시 찾지 못했습니다. 목록을 다시 불러와 최신 상태를 확인해 주세요.',
  );
  assert.equal(genericFailure.primary, '기본 안내');
  assert.equal(
    bridgeUnavailable.diagnostic,
    'Talkin AI desktop bridge is unavailable. Cannot access queries in this renderer context.',
  );
  assert.equal(unknownProject.diagnostic, 'Unknown project: project-001');
  assert.equal(genericFailure.diagnostic, 'Temporary database mismatch');
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

test('story-5.4:VAL-1, story-5.4:AC-1, and story-5.4:AC-2 workbench panels keep independent conversation history while follow-up submit stays on the same task and conversation', async () => {
  const temp = createTempDatabase();

  try {
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T04:00:00.000Z',
          '2026-06-08T04:01:00.000Z',
          '2026-06-08T04:05:00.000Z',
          '2026-06-08T04:06:00.000Z',
        ),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T04:02:00.000Z',
          '2026-06-08T04:03:00.000Z',
          '2026-06-08T04:04:00.000Z',
          '2026-06-08T04:07:00.000Z',
        ),
        createId: idFactory,
      }),
    });

    const firstTask = await service.commands.submitPrompt({
      promptKo: '첫 번째 패널에서 이어갈 사업 제안서를 만들어줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });
    const secondTask = await service.commands.submitPrompt({
      promptKo: '두 번째 패널에서 이어갈 리서치 요약을 만들어줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'long_context',
    });

    await service.commands.openInWorkbench({
      taskId: firstTask.taskId,
    });
    await service.commands.openInWorkbench({
      taskId: secondTask.taskId,
    });
    await markRunCompleted(temp.dbPath, firstTask.runId, '2026-06-08T04:04:30.000Z');
    await markRunCompleted(temp.dbPath, secondTask.runId, '2026-06-08T04:04:31.000Z');

    const initialLayout = await service.queries.getWorkbenchLayout({});
    const firstPanelConversationId =
      initialLayout.panels.find((panel) => panel.slot === 'north-west')?.conversation?.conversationId ??
      null;
    const secondPanelConversationId =
      initialLayout.panels.find((panel) => panel.slot === 'north-east')?.conversation?.conversationId ??
      null;

    assert.equal(firstPanelConversationId, firstTask.conversationId);
    assert.equal(secondPanelConversationId, secondTask.conversationId);

    await service.commands.submitPrompt({
      promptKo: '첫 번째 작업에 숫자 근거를 더 붙여줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
      conversationId: firstTask.conversationId,
    });
    await service.commands.submitPrompt({
      promptKo: '두 번째 작업은 경쟁사 비교를 한 문단 더 추가해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'long_context',
      conversationId: secondTask.conversationId,
    });

    const updatedLayout = await service.queries.getWorkbenchLayout({});
    const firstPanel = updatedLayout.panels.find((panel) => panel.slot === 'north-west');
    const secondPanel = updatedLayout.panels.find((panel) => panel.slot === 'north-east');

    assert.equal(firstPanel?.conversation?.conversationId, firstTask.conversationId);
    assert.equal(secondPanel?.conversation?.conversationId, secondTask.conversationId);
    assert.equal(firstPanel?.conversation?.messages.length, 2);
    assert.equal(secondPanel?.conversation?.messages.length, 2);
    assert.equal(
      firstPanel?.conversation?.messages.at(-1)?.contentKo,
      '첫 번째 작업에 숫자 근거를 더 붙여줘.',
    );
    assert.equal(
      secondPanel?.conversation?.messages.at(-1)?.contentKo,
      '두 번째 작업은 경쟁사 비교를 한 문단 더 추가해줘.',
    );
    assert.equal(firstPanel?.conversation?.runs.at(-1)?.status, 'queued');
    assert.equal(secondPanel?.conversation?.runs.at(-1)?.status, 'queued');
    assert.notEqual(
      firstPanel?.conversation?.runs.at(-1)?.sourceMessageId,
      secondPanel?.conversation?.runs.at(-1)?.sourceMessageId,
    );
  } finally {
    temp.cleanup();
  }
});

test('story-5.4:VAL-2 and story-5.4:AC-3 reducer keeps panel drafts, pending state, and errors isolated per slot', () => {
  let state = createWorkbenchComposerState();

  state = workbenchComposerReducer(state, {
    type: 'draft_changed',
    slot: 'north-west',
    draft: 'A 패널 추가 지시',
  });
  state = workbenchComposerReducer(state, {
    type: 'draft_changed',
    slot: 'north-east',
    draft: 'B 패널 추가 지시',
  });
  state = workbenchComposerReducer(state, {
    type: 'submit_started',
    slot: 'north-east',
  });
  state = workbenchComposerReducer(state, {
    type: 'submit_failed',
    slot: 'north-west',
    message: 'A 패널 저장 실패',
  });

  assert.equal(state['north-west'].draft, 'A 패널 추가 지시');
  assert.equal(state['north-west'].submitState.status, 'error');
  assert.equal(state['north-west'].submitState.message, 'A 패널 저장 실패');
  assert.equal(state['north-east'].draft, 'B 패널 추가 지시');
  assert.equal(state['north-east'].submitState.status, 'submitting');
  assert.equal(
    mergeWorkbenchPanelMessages(
      [
        {
          messageId: 'message-201',
          conversationId: 'conversation-201',
          runId: 'run-201',
          role: 'user',
          contentKo: '기존 요청',
          createdAt: '2026-06-08T04:10:00.000Z',
        },
      ],
      state['north-east'].pendingSubmission,
    ).length,
    1,
  );
  assert.equal(state['south-west'].submitState.status, 'idle');
  assert.equal(state['south-east'].draft, '');
});

test('story-5.4:VAL-3, story-5.4:AC-4, story-5.4:AC-5, and story-5.4:AC-6 workbench renders the same task history as chat and keeps feed, activity, and composer visually separated', async () => {
  const temp = createTempDatabase();

  try {
    const idFactory = createDeterministicIdFactory();
    const service = createDesktopIpcService({
      chatHistoryService: createPersistentChatHistoryService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T04:20:00.000Z',
          '2026-06-08T04:21:00.000Z',
        ),
        createId: idFactory,
      }),
      workbenchService: createPersistentWorkbenchService({
        dbPath: temp.dbPath,
        now: createSequenceNow(
          '2026-06-08T04:22:00.000Z',
          '2026-06-08T04:23:00.000Z',
        ),
        createId: idFactory,
      }),
    });

    const initialSubmit = await service.commands.submitPrompt({
      promptKo: '채팅에서 시작한 작업을 작업대에서 그대로 이어갈 수 있게 해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });
    await markRunCompleted(temp.dbPath, initialSubmit.runId, '2026-06-08T04:20:30.000Z');

    await service.commands.openInWorkbench({
      taskId: initialSubmit.taskId,
    });
    await service.commands.submitPrompt({
      promptKo: '같은 작업에 후속 검토 포인트도 덧붙여줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
      conversationId: initialSubmit.conversationId,
    });

    const chatFeed = await service.queries.getChatFeed({
      conversationId: initialSubmit.conversationId,
    });
    const layout = await service.queries.getWorkbenchLayout({});
    const panel = layout.panels.find((candidate) => candidate.taskId === initialSubmit.taskId);

    assert.deepEqual(panel?.conversation?.messages, chatFeed.messages);
    assert.deepEqual(panel?.conversation?.runs, chatFeed.runs);
    assert.equal(panel?.conversation?.activeRun?.runId, chatFeed.activeRun?.runId ?? null);
    assert.match(workbenchRouteSource, /desktopClient\.commands\.submitPrompt/);
    assert.match(workbenchRouteSource, /conversationId: panel\.conversation\.conversationId/);
    assert.match(workbenchRouteSource, /className="workbench-panel-feed"/);
    assert.match(workbenchRouteSource, /className="workbench-panel-activity"/);
    assert.match(workbenchRouteSource, /className="workbench-panel-compose"/);
    assert.match(
      workbenchStylesSource,
      /\.workbench-panel-feed,\s*\.workbench-panel-activity,\s*\.workbench-panel-compose\s*\{/,
    );
    assert.match(workbenchStylesSource, /\.workbench-activity-item\s*\{/);
    assert.match(workbenchStylesSource, /\.workbench-panel-compose\s*\{/);
  } finally {
    temp.cleanup();
  }
});
