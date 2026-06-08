import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentBoardService } from '../src/main/board/index.ts';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createDesktopInvalidationEmitter } from '../src/main/ipc/invalidation.ts';
import { registerDesktopIpcHandlers } from '../src/main/ipc/register-ipc.ts';
import { createChatRunPersistence, migrateDesktopSchema } from '../src/main/persistence/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import type { CloudInferenceGateway } from '../src/main/providers/index.ts';
import { createPersistentProjectService } from '../src/main/projects/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
} from '../src/main/settings/index.ts';
import {
  createFakeTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from '../src/main/translation/index.ts';
import { createPersistentWorkbenchService } from '../src/main/workbench/index.ts';
import {
  createPersistentOptimizationStageOrchestrator,
  createPersistentRestartRecoveryService,
  createPersistentResponseCompletionOrchestrator,
} from '../src/main/workflows/index.ts';
import { createTalkinAIDesktopApi } from '../src/preload/bridge.ts';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import {
  createDesktopQueryDescriptor,
  DesktopQueryCache,
} from '../src/renderer/lib/ipc/query-client.ts';
import type { DesktopInvalidationEvent } from '../src/shared/ipc/contracts.ts';

const mainIndexSource = readFileSync(
  new URL('../src/main/index.ts', import.meta.url),
  'utf8',
);

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-restart-recovery-'));
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

function createSequentialNow(startIso = '2026-06-09T00:00:00.000Z') {
  let currentMs = Date.parse(startIso);

  return () => {
    const next = new Date(currentMs).toISOString();
    currentMs += 1_000;
    return next;
  };
}

function createGateway(
  result: Awaited<ReturnType<CloudInferenceGateway['infer']>>,
): CloudInferenceGateway {
  return {
    async infer() {
      return result;
    },
  };
}

type Handler = (_event: unknown, request: unknown) => Promise<unknown> | unknown;
type EventListener = (_event: unknown, payload: unknown) => void;

function createFakeIpcRuntime() {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<EventListener>>();

  return {
    ipcMain: {
      handle(channel: string, listener: Handler) {
        handlers.set(channel, listener);
      },
    },
    ipcRenderer: {
      async invoke(channel: string, payload: unknown) {
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

async function readRunRows(dbPath: string, conversationId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    return await handle.connection.query<{
      id: string;
      message_id: string;
      status: string;
      error_code: string | null;
    }>(`
      SELECT id, message_id, status, error_code
      FROM run_records
      WHERE conversation_id = '${conversationId}'
      ORDER BY started_at ASC, rowid ASC;
    `);
  } finally {
    await handle.close();
  }
}

async function readRunStages(dbPath: string, runId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    return await handle.connection.query<{
      stage: string;
      status: string;
      details_json: string | null;
    }>(`
      SELECT stage, status, details_json
      FROM run_stages
      WHERE run_id = '${runId}'
      ORDER BY started_at ASC, rowid ASC;
    `);
  } finally {
    await handle.close();
  }
}

async function waitFor<TValue>(
  poll: () => Promise<TValue>,
  condition: (value: TValue) => boolean,
  label: string,
) {
  const timeoutAt = Date.now() + 1_500;

  while (true) {
    const value = await poll();
    if (condition(value)) {
      return value;
    }

    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForAssertion(assertion: () => boolean, label: string) {
  const timeoutAt = Date.now() + 1_500;

  while (!assertion()) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for ${label}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function promoteRunToInterruptedCloudPending(options: {
  dbPath: string;
  runId: string;
  createId: (prefix: string) => string;
  now: () => string;
}) {
  const handle = await openSqliteDatabase(options.dbPath);
  await migrateDesktopSchema(handle.connection);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await persistence.transaction(async (tx) => {
      await tx.runStages.create({
        id: options.createId('stage'),
        runId: options.runId,
        stage: 'optimizing',
        status: 'running',
        startedAt: options.now(),
        endedAt: null,
        details: {
          source: 'test-restart-recovery',
        },
      });
      await tx.promptArtifacts.create({
        id: options.createId('artifact'),
        runId: options.runId,
        artifactType: 'optimized_prompt_en',
        content:
          'Summarize the Korean support handoff. Preserve the checklist, the number 42, and Talkin AI.',
        tokenEstimate: 74,
        visibility: 'advanced',
      });
      await tx.runStages.create({
        id: options.createId('stage'),
        runId: options.runId,
        stage: 'optimized',
        status: 'completed',
        startedAt: options.now(),
        endedAt: options.now(),
        details: {
          source: 'test-restart-recovery',
        },
      });
      await tx.runRecords.updateStatus({
        runId: options.runId,
        status: 'cloud_pending',
        endedAt: null,
        errorCode: null,
      });
      await tx.runStages.create({
        id: options.createId('stage'),
        runId: options.runId,
        stage: 'cloud_pending',
        status: 'running',
        startedAt: options.now(),
        endedAt: null,
        details: {
          source: 'test-restart-recovery',
          provider: 'openai',
          model: 'gpt-4.1',
        },
      });
    });
  } finally {
    await persistence.close();
  }
}

async function promoteRunToOptimizing(options: {
  dbPath: string;
  runId: string;
  createId: (prefix: string) => string;
  now: () => string;
}) {
  const handle = await openSqliteDatabase(options.dbPath);
  await migrateDesktopSchema(handle.connection);
  const persistence = createChatRunPersistence(handle.connection);

  try {
    await persistence.transaction(async (tx) => {
      await tx.runRecords.updateStatus({
        runId: options.runId,
        status: 'optimizing',
        endedAt: null,
        errorCode: null,
      });
      await tx.runStages.create({
        id: options.createId('stage'),
        runId: options.runId,
        stage: 'optimizing',
        status: 'running',
        startedAt: options.now(),
        endedAt: null,
        details: {
          source: 'test-restart-recovery',
        },
      });
    });
  } finally {
    await persistence.close();
  }
}

async function completeRunForStartupSync(options: {
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
          source: 'test-startup-sync',
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

test('story-6.3:GOAL-1 main bootstrap wires restart recovery into the desktop startup flow', () => {
  assert.match(mainIndexSource, /createPersistentRestartRecoveryService/);
  assert.match(mainIndexSource, /restartRecoveryService\.recoverInterruptedRuns\(\)/);
});

test('story-6.3:VAL-1 and story-6.3:AC-1 queued and optimizing runs safely resume after restart recovery', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-09T01:00:00.000Z');
  const createId = createDeterministicIdFactory();

  try {
    const initialChatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });
    const queuedRun = await initialChatHistoryService.submitPrompt({
      promptKo: '첫 번째 장문 요약 요청입니다.\n숫자 42와 체크리스트를 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });
    const interruptedOptimizingRun = await initialChatHistoryService.submitPrompt({
      promptKo: '두 번째 장문 요약 요청입니다.\nTalkin AI 이름과 표 구조를 유지해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });

    await promoteRunToOptimizing({
      dbPath: temp.dbPath,
      runId: interruptedOptimizingRun.runId,
      createId,
      now,
    });

    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt(input) {
          return {
            optimizedEnglish: `Recovered prompt: ${input.sourceKorean}`,
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse(input) {
          return {
            restoredKorean: `복구 완료: ${input.sourceKorean.split('\n')[0]}`,
          };
        },
      }),
    });
    const settingsService = createInMemoryAppSettingsService({
      ...defaultAppSettings,
      responseLanguage: 'ko',
    });
    const responseCompletionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: 'Recovered English response with checklist and 42.',
        usage: {
          inputTokens: 84,
          outputTokens: 33,
        },
        latencyMs: 410,
      }),
      now,
      createId,
    });
    const optimizationStageOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return responseCompletionOrchestrator.completeOptimizedRun(input);
      },
    });
    const recoveryService = createPersistentRestartRecoveryService({
      dbPath: temp.dbPath,
      optimizationStageOrchestrator,
      responseCompletionOrchestrator,
      now,
      createId,
    });
    const queryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });

    const recoveryResult = await recoveryService.recoverInterruptedRuns();
    const firstFeed = await queryService.getChatFeed({
      conversationId: queuedRun.conversationId,
    });
    const secondFeed = await queryService.getChatFeed({
      conversationId: interruptedOptimizingRun.conversationId,
    });
    const secondRunStages = await readRunStages(temp.dbPath, interruptedOptimizingRun.runId);

    assert.deepEqual(
      recoveryResult.resumedQueuedRunIds.sort(),
      [queuedRun.runId, interruptedOptimizingRun.runId].sort(),
    );
    assert.deepEqual(recoveryResult.resumedOptimizedRunIds, []);
    assert.deepEqual(recoveryResult.interruptedAfterDispatchRunIds, []);
    assert.equal(firstFeed.activeRun?.status, 'completed');
    assert.equal(secondFeed.activeRun?.status, 'completed');
    assert.equal(firstFeed.messages[0]?.contentKo, '첫 번째 장문 요약 요청입니다.\n숫자 42와 체크리스트를 유지해줘.');
    assert.equal(secondFeed.messages[0]?.contentKo, '두 번째 장문 요약 요청입니다.\nTalkin AI 이름과 표 구조를 유지해줘.');
    assert.ok(
      secondRunStages.some((stage) => {
        const details = JSON.parse(stage.details_json ?? 'null') as Record<string, unknown> | null;
        return (
          stage.stage === 'queued' &&
          details?.source === 'restart-recovery' &&
          details?.recoveredFromStage === 'optimizing'
        );
      }),
    );
  } finally {
    temp.cleanup();
  }
});

test('story-6.3:VAL-2 and story-6.3:AC-2 interrupted-after-dispatch runs require explicit retry after restart recovery', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-09T02:00:00.000Z');
  const createId = createDeterministicIdFactory();

  try {
    const initialChatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });
    const interruptedRun = await initialChatHistoryService.submitPrompt({
      promptKo: '운영 인수인계 초안을 요약해줘.\n체크리스트와 숫자 42를 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    await promoteRunToInterruptedCloudPending({
      dbPath: temp.dbPath,
      runId: interruptedRun.runId,
      createId,
      now,
    });

    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({}),
    });
    const settingsService = createInMemoryAppSettingsService(defaultAppSettings);
    const responseCompletionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: 'unused',
        latencyMs: 1,
      }),
      now,
      createId,
    });
    const optimizationStageOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return responseCompletionOrchestrator.completeOptimizedRun(input);
      },
    });
    const recoveryService = createPersistentRestartRecoveryService({
      dbPath: temp.dbPath,
      optimizationStageOrchestrator,
      responseCompletionOrchestrator,
      now,
      createId,
    });
    const queryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });

    const recoveryResult = await recoveryService.recoverInterruptedRuns();
    const feed = await queryService.getChatFeed({
      conversationId: interruptedRun.conversationId,
    });

    assert.deepEqual(recoveryResult.resumedQueuedRunIds, []);
    assert.deepEqual(recoveryResult.resumedOptimizedRunIds, []);
    assert.deepEqual(recoveryResult.interruptedAfterDispatchRunIds, [interruptedRun.runId]);
    assert.equal(feed.activeRun?.runId, interruptedRun.runId);
    assert.equal(feed.activeRun?.status, 'failed');
    assert.equal(feed.activeRun?.errorCode, 'interrupted_after_dispatch');
    assert.equal(feed.activeRun?.failure?.failedStage, 'cloud_pending');
    assert.equal(feed.activeRun?.failure?.retryable, true);
    assert.match(feed.activeRun?.failure?.guidance ?? '', /명시적으로 다시 시도/);
    assert.equal(feed.messages[0]?.messageId, interruptedRun.messageId);
    assert.equal(
      feed.messages[0]?.contentKo,
      '운영 인수인계 초안을 요약해줘.\n체크리스트와 숫자 42를 유지해줘.',
    );
  } finally {
    temp.cleanup();
  }
});

test('story-6.3:VAL-3 and story-6.3:AC-3 retry after interrupted-after-dispatch reuses the same Korean source message', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-09T03:00:00.000Z');
  const createId = createDeterministicIdFactory();

  try {
    const initialChatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });
    const interruptedRun = await initialChatHistoryService.submitPrompt({
      promptKo: '프로젝트 상태 보고서를 다시 정리해줘.\n표와 체크리스트를 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    await promoteRunToInterruptedCloudPending({
      dbPath: temp.dbPath,
      runId: interruptedRun.runId,
      createId,
      now,
    });

    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt(input) {
          return {
            optimizedEnglish: `Retry optimized prompt: ${input.sourceKorean}`,
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse() {
          return {
            restoredKorean: '재시도 후 한국어 응답이 복원되었습니다.',
          };
        },
      }),
    });
    const settingsService = createInMemoryAppSettingsService({
      ...defaultAppSettings,
      responseLanguage: 'ko',
    });
    const responseCompletionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: 'Retry English response with preserved checklist.',
        usage: {
          inputTokens: 88,
          outputTokens: 41,
        },
        latencyMs: 460,
      }),
      now,
      createId,
    });
    const optimizationStageOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return responseCompletionOrchestrator.completeOptimizedRun(input);
      },
    });
    const recoveryService = createPersistentRestartRecoveryService({
      dbPath: temp.dbPath,
      optimizationStageOrchestrator,
      responseCompletionOrchestrator,
      now,
      createId,
    });

    await recoveryService.recoverInterruptedRuns();

    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator,
    });
    const retryResult = await chatHistoryService.retryRun({
      runId: interruptedRun.runId,
    });
    const completedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: interruptedRun.conversationId,
        }),
      (feed) =>
        feed.activeRun?.runId === retryResult.runId &&
        feed.activeRun?.status === 'completed',
      'completed retry after interrupted-after-dispatch',
    );
    const runs = await readRunRows(temp.dbPath, interruptedRun.conversationId);

    assert.notEqual(retryResult.runId, interruptedRun.runId);
    assert.deepEqual(
      runs.map((run) => ({
        id: run.id,
        messageId: run.message_id,
        status: run.status,
        errorCode: run.error_code,
      })),
      [
        {
          id: interruptedRun.runId,
          messageId: interruptedRun.messageId,
          status: 'failed',
          errorCode: 'interrupted_after_dispatch',
        },
        {
          id: retryResult.runId,
          messageId: interruptedRun.messageId,
          status: 'completed',
          errorCode: null,
        },
      ],
    );
    assert.equal(completedFeed.activeRun?.sourceMessageId, interruptedRun.messageId);
    assert.equal(completedFeed.messages[0]?.messageId, interruptedRun.messageId);
    assert.equal(completedFeed.messages[0]?.contentKo, '프로젝트 상태 보고서를 다시 정리해줘.\n표와 체크리스트를 유지해줘.');
    assert.match(completedFeed.messages[1]?.contentKo ?? '', /재시도 후 한국어 응답/);
  } finally {
    temp.cleanup();
  }
});

test('story-6.4:VAL-3 and story-6.4:AC-4 restart recovery invalidates stale startup projections when another settled task is initially active', async () => {
  const temp = createTempDatabase();
  const runtime = createFakeIpcRuntime();
  const now = createSequentialNow('2026-06-09T06:00:00.000Z');
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
    const project = await client.commands.createProject({
      name: '운영 복구',
      description: 'startup recovery projection refresh 테스트용 프로젝트',
      goal: '다른 task가 active여도 restart recovery가 stale 화면을 자동으로 갱신해야 한다.',
    });
    const settledTask = await client.commands.submitPrompt({
      promptKo: '완료된 작업으로 남겨둘 운영 정리 요청입니다.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });
    const recoveringTask = await client.commands.submitPrompt({
      promptKo: '복구 대상인 장문 작업입니다.\n체크리스트와 숫자 42를 유지해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });

    await client.commands.setTaskProject({
      taskId: recoveringTask.taskId,
      projectId: project.projectId,
    });
    await client.commands.openInWorkbench({
      taskId: recoveringTask.taskId,
    });

    await promoteRunToInterruptedCloudPending({
      dbPath: temp.dbPath,
      runId: recoveringTask.runId,
      createId,
      now: createSequentialNow('2026-06-09T06:06:00.000Z'),
    });
    await completeRunForStartupSync({
      dbPath: temp.dbPath,
      runId: settledTask.runId,
      conversationId: settledTask.conversationId,
      taskId: settledTask.taskId,
      assistantMessage: '정리된 운영 답변입니다.',
      completedAt: '2026-06-09T06:10:00.000Z',
      createId,
    });

    const chatFeedQuery = createDesktopQueryDescriptor('getChatFeed', {});
    const workbenchQuery = createDesktopQueryDescriptor('getWorkbenchLayout', {});
    const boardQuery = createDesktopQueryDescriptor('getBoardColumns', {});
    const projectDetailQuery = createDesktopQueryDescriptor('getProjectDetail', {
      projectId: project.projectId,
    });

    await Promise.all([
      queryCache.fetchQuery(chatFeedQuery),
      queryCache.fetchQuery(workbenchQuery),
      queryCache.fetchQuery(boardQuery),
      queryCache.fetchQuery(projectDetailQuery),
    ]);

    const initialChatFeed = queryCache.getSnapshot(chatFeedQuery).data;
    const initialBoard = queryCache.getSnapshot(boardQuery).data;

    assert.equal(initialChatFeed?.activeTaskId, settledTask.taskId);

    const initialRecoverCard =
      initialBoard?.columns
        .flatMap((column) => column.cards)
        .find((card) => card.taskId === recoveringTask.taskId) ?? null;

    assert.ok(initialRecoverCard);

    const invalidationEmitter = createDesktopInvalidationEmitter({
      broadcast: runtime.broadcast,
    });
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({}),
    });
    const settingsService = createInMemoryAppSettingsService(defaultAppSettings);
    const responseCompletionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: 'unused',
        latencyMs: 1,
      }),
      now: createSequentialNow('2026-06-09T06:20:00.000Z'),
      createId,
      emitInvalidation(targets) {
        invalidationEmitter.emit(
          {
            type: 'workflow',
            name: 'responseCompletion',
          },
          targets,
        );
      },
    });
    const optimizationStageOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now: createSequentialNow('2026-06-09T06:20:00.000Z'),
      createId,
      emitInvalidation(targets) {
        invalidationEmitter.emit(
          {
            type: 'workflow',
            name: 'optimizationStage',
          },
          targets,
        );
      },
      dispatchOptimizedRun(input) {
        return responseCompletionOrchestrator.completeOptimizedRun(input);
      },
    });
    const recoveryService = createPersistentRestartRecoveryService({
      dbPath: temp.dbPath,
      optimizationStageOrchestrator,
      responseCompletionOrchestrator,
      now: createSequentialNow('2026-06-09T06:21:00.000Z'),
      createId,
      emitInvalidation(targets) {
        invalidationEmitter.emit(
          {
            type: 'workflow',
            name: 'restartRecovery',
          },
          targets,
        );
      },
    });

    const recoveryResult = await recoveryService.recoverInterruptedRuns();

    await waitForAssertion(() => {
      const chatFeed = queryCache.getSnapshot(chatFeedQuery).data;
      const workbench = queryCache.getSnapshot(workbenchQuery).data;
      const board = queryCache.getSnapshot(boardQuery).data;
      const projectDetail = queryCache.getSnapshot(projectDetailQuery).data;
      const recoveredBoardCard =
        board?.columns
          .flatMap((column) => column.cards)
          .find((card) => card.taskId === recoveringTask.taskId) ?? null;
      const recoveredPanel =
        workbench?.panels.find((panel) => panel.taskId === recoveringTask.taskId) ?? null;
      const recoveredProjectTask =
        projectDetail?.tasks.find((task) => task.taskId === recoveringTask.taskId) ?? null;

      return (
        chatFeed?.activeTaskId === recoveringTask.taskId &&
        chatFeed?.activeRun?.status === 'failed' &&
        recoveredPanel?.conversation?.activeRun?.status === 'failed' &&
        recoveredBoardCard?.lastActivityAt === recoveredProjectTask?.lastActivityAt &&
        recoveredBoardCard?.lastActivityAt !== initialRecoverCard.lastActivityAt
      );
    }, 'restart recovery projections to refetch automatically');

    const recoveredChatFeed = queryCache.getSnapshot(chatFeedQuery).data;
    const recoveredWorkbench = queryCache.getSnapshot(workbenchQuery).data;
    const recoveredBoard = queryCache.getSnapshot(boardQuery).data;
    const recoveredProjectDetail = queryCache.getSnapshot(projectDetailQuery).data;
    const recoveredBoardCard =
      recoveredBoard?.columns
        .flatMap((column) => column.cards)
        .find((card) => card.taskId === recoveringTask.taskId) ?? null;
    const recoveredPanel =
      recoveredWorkbench?.panels.find((panel) => panel.taskId === recoveringTask.taskId) ?? null;
    const recoveredProjectTask =
      recoveredProjectDetail?.tasks.find((task) => task.taskId === recoveringTask.taskId) ?? null;

    assert.deepEqual(recoveryResult.resumedQueuedRunIds, []);
    assert.deepEqual(recoveryResult.resumedOptimizedRunIds, []);
    assert.deepEqual(recoveryResult.interruptedAfterDispatchRunIds, [recoveringTask.runId]);
    assert.equal(recoveredChatFeed?.activeTaskId, recoveringTask.taskId);
    assert.equal(recoveredChatFeed?.activeRun?.status, 'failed');
    assert.equal(recoveredChatFeed?.activeRun?.errorCode, 'interrupted_after_dispatch');
    assert.equal(recoveredPanel?.conversation?.activeRun?.status, 'failed');
    assert.equal(recoveredBoardCard?.lastActivityAt, recoveredProjectTask?.lastActivityAt);
    assert.notEqual(recoveredBoardCard?.lastActivityAt, initialRecoverCard.lastActivityAt);
    assert.ok(
      receivedEvents.some(
        (event) =>
          event.source.type === 'workflow' &&
          event.source.name === 'restartRecovery' &&
          event.targets.some(
            (target) => target.kind === 'projection' && target.projection === 'chatFeed',
          ),
      ),
    );
  } finally {
    unsubscribe();
    queryCache.dispose();
    temp.cleanup();
  }
});
