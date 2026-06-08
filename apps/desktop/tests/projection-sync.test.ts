import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentBoardService } from '../src/main/board/index.ts';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { registerDesktopIpcHandlers } from '../src/main/ipc/register-ipc.ts';
import { createPersistentProjectService } from '../src/main/projects/index.ts';
import { createPersistentWorkbenchService } from '../src/main/workbench/index.ts';
import { createChatRunPersistence, migrateDesktopSchema } from '../src/main/persistence/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import { createTalkinAIDesktopApi } from '../src/preload/bridge.ts';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import {
  createDesktopQueryDescriptor,
  DesktopQueryCache,
} from '../src/renderer/lib/ipc/query-client.ts';
import {
  ipcChannels,
  type DesktopInvalidationEvent,
} from '../src/shared/ipc/contracts.ts';

type Handler = (_event: unknown, request: unknown) => Promise<unknown> | unknown;
type EventListener = (_event: unknown, payload: unknown) => void;

function createFakeIpcRuntime() {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<EventListener>>();
  const invocations: string[] = [];

  return {
    handlers,
    invocations,
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener);
      },
    },
    ipcRenderer: {
      async invoke(channel: string, payload: unknown) {
        invocations.push(channel);
        const handler = handlers.get(channel);
        assert.ok(handler, `No handler registered for ${channel}`);
        return handler({}, payload);
      },
      on(channel: string, listener: EventListener) {
        const current = listeners.get(channel) ?? new Set<EventListener>();
        current.add(listener);
        listeners.set(channel, current);
      },
      off(channel: string, listener: EventListener) {
        listeners.get(channel)?.delete(listener);
      },
    },
    broadcast(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
  };
}

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-projection-sync-'));
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

function createSequentialNow(startIso = '2026-06-09T05:00:00.000Z') {
  let currentMs = Date.parse(startIso);

  return () => {
    const next = new Date(currentMs).toISOString();
    currentMs += 1_000;
    return next;
  };
}

async function waitFor(assertion: () => boolean, label: string) {
  const timeoutAt = Date.now() + 1_500;

  while (!assertion()) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function markRunCompleted(options: {
  dbPath: string;
  runId: string;
  conversationId: string;
  taskId: string;
  assistantMessage: string;
  completedAt: string;
  createId: (prefix: string) => string;
}) {
  const handle = await openSqliteDatabase(options.dbPath);
  await migrateDesktopSchema(handle.connection);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await persistence.transaction(async (tx) => {
      await tx.messages.create({
        id: options.createId('message'),
        conversationId: options.conversationId,
        role: 'assistant',
        contentKo: options.assistantMessage,
        runId: options.runId,
        createdAt: options.completedAt,
      });
      await tx.runRecords.updateStatus({
        runId: options.runId,
        status: 'completed',
        endedAt: options.completedAt,
        errorCode: null,
      });
      await tx.runStages.create({
        id: options.createId('stage'),
        runId: options.runId,
        stage: 'completed',
        status: 'completed',
        startedAt: options.completedAt,
        endedAt: options.completedAt,
        details: {
          source: 'test-projection-sync',
        },
      });
      await tx.tasks.updateActivity({
        taskId: options.taskId,
        updatedAt: options.completedAt,
        lastActivityAt: options.completedAt,
      });
    });
  } finally {
    await persistence.close();
  }
}

test('story-6.4:VAL-1 and story-6.4:VAL-2 cross-screen mutations converge on the same canonical task projections', async () => {
  const temp = createTempDatabase();
  const runtime = createFakeIpcRuntime();
  const now = createSequentialNow();
  const createId = createDeterministicIdFactory();

  registerDesktopIpcHandlers(runtime.ipcMain, {
    broadcast: runtime.broadcast,
    boardService: createPersistentBoardService({
      dbPath: temp.dbPath,
      now,
    }),
    chatHistoryService: createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    }),
    projectService: createPersistentProjectService({
      dbPath: temp.dbPath,
      now,
      createId,
    }),
    workbenchService: createPersistentWorkbenchService({
      dbPath: temp.dbPath,
      now,
      createId,
    }),
  });

  const api = createTalkinAIDesktopApi(runtime.ipcRenderer, {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);
  const queryCache = new DesktopQueryCache(client);
  const receivedEvents: DesktopInvalidationEvent[] = [];
  const unsubscribe = client.events.onInvalidation((payload) => {
    receivedEvents.push(payload);
  });

  try {
    const chatFeedQuery = createDesktopQueryDescriptor('getChatFeed', {});
    const workbenchQuery = createDesktopQueryDescriptor('getWorkbenchLayout', {});
    const boardQuery = createDesktopQueryDescriptor('getBoardColumns', {});
    const projectListQuery = createDesktopQueryDescriptor('getProjectList', {});

    const project = await client.commands.createProject({
      name: '사업계획서',
      description: 'cross-screen sync 테스트용 프로젝트',
      goal: '같은 task가 chat/workbench/kanban/project에서 하나의 source of truth를 유지하는지 확인',
    });
    const projectDetailQuery = createDesktopQueryDescriptor('getProjectDetail', {
      projectId: project.projectId,
    });

    await Promise.all([
      queryCache.fetchQuery(chatFeedQuery),
      queryCache.fetchQuery(workbenchQuery),
      queryCache.fetchQuery(boardQuery),
      queryCache.fetchQuery(projectListQuery),
      queryCache.fetchQuery(projectDetailQuery),
    ]);

    const submitResult = await client.commands.submitPrompt({
      promptKo: '파트너 제안서 초안을 한국어로 다듬고 핵심 근거를 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    await client.commands.openInWorkbench({
      taskId: submitResult.taskId,
    });
    await client.commands.setTaskProject({
      taskId: submitResult.taskId,
      projectId: project.projectId,
    });
    await client.commands.moveTaskStatus({
      taskId: submitResult.taskId,
      status: 'ai_review',
    });
    await markRunCompleted({
      dbPath: temp.dbPath,
      runId: submitResult.runId,
      conversationId: submitResult.conversationId,
      taskId: submitResult.taskId,
      assistantMessage: '초안의 핵심 근거를 유지한 첫 번째 응답입니다.',
      completedAt: '2026-06-09T05:20:00.000Z',
      createId,
    });
    await client.commands.submitPrompt({
      conversationId: submitResult.conversationId,
      promptKo: '체크리스트 3개와 숫자 42를 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    await waitFor(() => {
      const chatFeed = queryCache.getSnapshot(chatFeedQuery).data;
      const workbench = queryCache.getSnapshot(workbenchQuery).data;
      const board = queryCache.getSnapshot(boardQuery).data;
      const projectList = queryCache.getSnapshot(projectListQuery).data;
      const projectDetail = queryCache.getSnapshot(projectDetailQuery).data;
      const boardCard = board?.columns.flatMap((column) => column.cards).find(
        (card) => card.taskId === submitResult.taskId,
      );
      const workbenchTask = workbench?.recentTasks.find((task) => task.taskId === submitResult.taskId);
      const workbenchPanel = workbench?.panels.find((panel) => panel.taskId === submitResult.taskId);
      const projectTask = projectDetail?.tasks.find((task) => task.taskId === submitResult.taskId);
      const projectSummary = projectList?.projects.find((entry) => entry.projectId === project.projectId);

      return (
        chatFeed?.items.find((item) => item.taskId === submitResult.taskId)?.status === 'ai_review' &&
        boardCard?.status === 'ai_review' &&
        boardCard?.projectName === '사업계획서' &&
        workbenchTask?.status === 'ai_review' &&
        workbenchTask?.projectName === '사업계획서' &&
        workbenchPanel?.conversation?.messages.filter((message) => message.role === 'user').length === 2 &&
        workbenchPanel?.conversation?.messages.some(
          (message) => message.contentKo === '체크리스트 3개와 숫자 42를 유지해줘.',
        ) &&
        projectTask?.status === 'ai_review' &&
        projectSummary?.taskCount === 1
      );
    }, 'cross-screen projection convergence');

    const chatFeed = queryCache.getSnapshot(chatFeedQuery).data;
    const workbench = queryCache.getSnapshot(workbenchQuery).data;
    const board = queryCache.getSnapshot(boardQuery).data;
    const projectDetail = queryCache.getSnapshot(projectDetailQuery).data;
    const projectList = queryCache.getSnapshot(projectListQuery).data;

    assert.ok(chatFeed);
    assert.ok(workbench);
    assert.ok(board);
    assert.ok(projectDetail);
    assert.ok(projectList);

    const chatItem = chatFeed.items.find((item) => item.taskId === submitResult.taskId);
    const boardCard =
      board.columns
        .flatMap((column) => column.cards)
        .find((card) => card.taskId === submitResult.taskId) ?? null;
    const workbenchTask =
      workbench.recentTasks.find((task) => task.taskId === submitResult.taskId) ?? null;
    const workbenchPanel =
      workbench.panels.find((panel) => panel.taskId === submitResult.taskId) ?? null;
    const projectTask =
      projectDetail.tasks.find((task) => task.taskId === submitResult.taskId) ?? null;
    const projectSummary =
      projectList.projects.find((entry) => entry.projectId === project.projectId) ?? null;

    assert.ok(chatItem);
    assert.ok(boardCard);
    assert.ok(workbenchTask);
    assert.ok(workbenchPanel);
    assert.ok(projectTask);
    assert.ok(projectSummary);

    const sharedActivityAt = chatItem.updatedAt;

    assert.equal(boardCard.status, 'ai_review');
    assert.equal(workbenchTask.status, 'ai_review');
    assert.equal(projectTask.status, 'ai_review');
    assert.equal(boardCard.projectName, '사업계획서');
    assert.equal(workbenchTask.projectName, '사업계획서');
    assert.equal(projectSummary.taskCount, 1);
    assert.equal(boardCard.lastActivityAt, sharedActivityAt);
    assert.equal(workbenchTask.lastActivityAt, sharedActivityAt);
    assert.equal(projectTask.lastActivityAt, sharedActivityAt);
    assert.equal(
      workbenchPanel.conversation?.messages.some(
        (message) => message.contentKo === '체크리스트 3개와 숫자 42를 유지해줘.',
      ),
      true,
    );

    assert.ok(
      receivedEvents.some(
        (event) =>
          event.source.type === 'command' &&
          event.source.name === 'setTaskProject' &&
          event.targets.some(
            (target) => target.kind === 'projection' && target.projection === 'projectDetail',
          ),
      ),
    );
    assert.ok(
      receivedEvents.some(
        (event) =>
          event.source.type === 'command' &&
          event.source.name === 'moveTaskStatus' &&
          event.targets.some(
            (target) => target.kind === 'entity' && target.entity === 'task',
          ),
      ),
    );
    assert.ok(
      receivedEvents.filter(
        (event) => event.source.type === 'command' && event.source.name === 'submitPrompt',
      ).length >= 2,
    );
    assert.ok(
      runtime.invocations.filter((channel) => channel === ipcChannels.queries.getProjectDetail).length >= 2,
    );
    assert.ok(
      runtime.invocations.filter((channel) => channel === ipcChannels.queries.getWorkbenchLayout).length >= 2,
    );
  } finally {
    unsubscribe();
    queryCache.dispose();
    temp.cleanup();
  }
});
