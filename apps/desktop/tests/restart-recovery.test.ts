import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { createChatRunPersistence, migrateDesktopSchema } from '../src/main/persistence/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import type { CloudInferenceGateway } from '../src/main/providers/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
} from '../src/main/settings/index.ts';
import {
  createFakeTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from '../src/main/translation/index.ts';
import {
  createPersistentOptimizationStageOrchestrator,
  createPersistentRestartRecoveryService,
  createPersistentResponseCompletionOrchestrator,
} from '../src/main/workflows/index.ts';

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
