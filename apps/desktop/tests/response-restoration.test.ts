import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import type { CloudInferenceGateway } from '../src/main/providers/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import {
  createInMemoryAppSettingsService,
  createPersistentAppSettingsService,
  defaultAppSettings,
} from '../src/main/settings/index.ts';
import {
  TranslationMcpRuntimeError,
  createFakeTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from '../src/main/translation/index.ts';
import {
  createPersistentOptimizationStageOrchestrator,
  createPersistentResponseCompletionOrchestrator,
} from '../src/main/workflows/index.ts';
import { estimateTokenCount } from '../src/main/workflows/run-helpers.ts';

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-response-restoration-'));
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

function createSequentialNow(startIso = '2026-06-08T11:00:00.000Z') {
  let currentMs = Date.parse(startIso);

  return () => {
    const next = new Date(currentMs).toISOString();
    currentMs += 1_000;
    return next;
  };
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

async function readRunArtifacts(dbPath: string, runId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    return await handle.connection.query<{
      artifact_type: string;
      content: string;
      token_estimate: number | null;
      visibility: string;
    }>(`
      SELECT artifact_type, content, token_estimate, visibility
      FROM prompt_artifacts
      WHERE run_id = '${runId}'
      ORDER BY rowid ASC;
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
    }>(`
      SELECT stage, status
      FROM run_stages
      WHERE run_id = '${runId}'
      ORDER BY started_at ASC, rowid ASC;
    `);
  } finally {
    await handle.close();
  }
}

async function readRunRecord(dbPath: string, runId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    const rows = await handle.connection.query<{
      status: string;
      error_code: string | null;
    }>(`
      SELECT status, error_code
      FROM run_records
      WHERE id = '${runId}';
    `);

    return rows[0] ?? null;
  } finally {
    await handle.close();
  }
}

async function readConversationMessages(dbPath: string, conversationId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    return await handle.connection.query<{
      role: string;
      content_ko: string;
      run_id: string | null;
    }>(`
      SELECT role, content_ko, run_id
      FROM messages
      WHERE conversation_id = '${conversationId}'
      ORDER BY created_at ASC, rowid ASC;
    `);
  } finally {
    await handle.close();
  }
}

async function readUsageRecord(dbPath: string, runId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    const rows = await handle.connection.query<{
      baseline_input_tokens: number;
      optimized_input_tokens: number;
      output_tokens: number;
      estimated_cost_without_optimization: number;
      estimated_cost_with_optimization: number;
      pricing_version: string;
      latency_ms: number;
      is_estimated: number;
    }>(`
      SELECT
        baseline_input_tokens,
        optimized_input_tokens,
        output_tokens,
        estimated_cost_without_optimization,
        estimated_cost_with_optimization,
        pricing_version,
        latency_ms,
        is_estimated
      FROM usage_records
      WHERE run_id = '${runId}';
    `);

    return rows[0] ?? null;
  } finally {
    await handle.close();
  }
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

test('story-3.4:VAL-1, story-3.4:AC-1, and story-3.4:AC-4 restore a structured English response into final Korean output without losing tables, lists, numbers, or checklists', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T11:00:00.000Z');
  const createId = createDeterministicIdFactory();
  const restoreCalls: Array<{
    sourceKorean: string;
    optimizedEnglish: string;
    cloudEnglishResponse: string;
  }> = [];
  const cloudEnglishResponse = [
    '## Execution Summary',
    '',
    '| Item | Value |',
    '| --- | --- |',
    '| Budget | 42 |',
    '| Product | Talkin AI |',
    '',
    '1. Review the 3-step rollout.',
    '2. Keep the risk checklist visible.',
    '',
    '- Preserve the numeric evidence 42',
    '- Preserve the proper noun Talkin AI',
    '',
    '- [ ] Confirm metrics',
    '- [ ] Finalize handoff',
  ].join('\n');
  const restoredKorean = [
    '## 실행 요약',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    '| 예산 | 42 |',
    '| 제품 | Talkin AI |',
    '',
    '1. 3단계 롤아웃을 검토합니다.',
    '2. 리스크 체크리스트를 그대로 유지합니다.',
    '',
    '- 숫자 42를 그대로 유지합니다.',
    '- 고유명사 Talkin AI를 그대로 유지합니다.',
    '',
    '- [ ] 지표 확인',
    '- [ ] 전달 준비',
  ].join('\n');

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          return {
            optimizedEnglish:
              'Return a structured execution summary. Preserve tables, lists, checklist syntax, the number 42, and the Talkin AI name.',
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse(input) {
          restoreCalls.push({
            sourceKorean: input.sourceKorean,
            optimizedEnglish: input.optimizedEnglish,
            cloudEnglishResponse: input.cloudEnglishResponse,
          });

          return {
            restoredKorean,
          };
        },
      }),
    });
    const settingsService = createInMemoryAppSettingsService({
      ...defaultAppSettings,
      responseLanguage: 'ko',
    });
    const completionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: cloudEnglishResponse,
        usage: {
          inputTokens: 124,
          outputTokens: 96,
          totalTokens: 220,
        },
        latencyMs: 840,
      }),
      now,
      createId,
    });
    const optimizationOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return completionOrchestrator.completeOptimizedRun(input);
      },
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: optimizationOrchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo:
        '사업계획서 초안을 정리해줘.\n표와 체크리스트 형식을 유지하고 숫자 42와 Talkin AI는 그대로 남겨줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    const completedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'completed' && feed.activeRun?.stage === 'completed',
      'completed run after Korean restoration',
    );
    const artifacts = await readRunArtifacts(temp.dbPath, submitResult.runId);
    const stages = await readRunStages(temp.dbPath, submitResult.runId);
    const messages = await readConversationMessages(temp.dbPath, submitResult.conversationId);
    const usageRecord = await readUsageRecord(temp.dbPath, submitResult.runId);

    assert.equal(completedFeed.activeRun?.status, 'completed');
    assert.equal(completedFeed.activeRun?.stage, 'completed');
    assert.equal(completedFeed.runs.length, 1);
    assert.deepEqual(completedFeed.runs[0]?.usage, {
      baselineInputTokens: usageRecord?.baseline_input_tokens ?? 0,
      optimizedInputTokens: 124,
      outputTokens: 96,
      latencyMs: 840,
      savingsRate: 0,
      isEstimated: false,
    });
    assert.equal(restoreCalls.length, 1);
    assert.match(restoreCalls[0]?.cloudEnglishResponse ?? '', /\| Budget \| 42 \|/);
    assert.deepEqual(
      stages.map((stage) => `${stage.stage}:${stage.status}`),
      [
        'queued:pending',
        'optimizing:running',
        'optimized:completed',
        'cloud_pending:running',
        'restoring:running',
        'completed:completed',
      ],
    );
    assert.deepEqual(
      artifacts.map((artifact) => artifact.artifact_type),
      [
        'optimized_prompt_en',
        'preservation_check',
        'provider_response_en',
        'restored_response_ko',
      ],
    );
    assert.equal(artifacts[2]?.content, cloudEnglishResponse);
    assert.equal(artifacts[3]?.content, restoredKorean);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.role, 'assistant');
    assert.equal(messages[1]?.content_ko, restoredKorean);
    assert.match(messages[1]?.content_ko ?? '', /\| 항목 \| 값 \|/);
    assert.match(messages[1]?.content_ko ?? '', /1\. 3단계 롤아웃/);
    assert.match(messages[1]?.content_ko ?? '', /- \[ \] 지표 확인/);
    assert.match(messages[1]?.content_ko ?? '', /42/);
    assert.match(messages[1]?.content_ko ?? '', /Talkin AI/);
    assert.ok(usageRecord);
    assert.equal(usageRecord?.optimized_input_tokens, 124);
    assert.equal(usageRecord?.output_tokens, 96);
    assert.equal(usageRecord?.latency_ms, 840);
    assert.equal(usageRecord?.pricing_version, 'openai-gpt-4.1-2026-06');
    assert.equal(usageRecord?.is_estimated, 0);
    assert.ok((usageRecord?.baseline_input_tokens ?? 0) > 0);
  } finally {
    temp.cleanup();
  }
});

test('story-4.1:VAL-2 and story-4.1:AC-3 persist estimate-marked ledger rows when provider usage is unavailable', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T12:30:00.000Z');
  const createId = createDeterministicIdFactory();
  const optimizedEnglish =
    'Write a support handoff checklist. Keep 42 and Talkin AI.';
  const responseEnglish =
    '1. Keep the 42 metric visible.\n2. Preserve the Talkin AI name.\n- [ ] Review the handoff checklist.';

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          return {
            optimizedEnglish,
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse() {
          return {
            restoredKorean: '이 복원 호출은 실행되면 안 됩니다.',
          };
        },
      }),
    });
    const settingsService = createPersistentAppSettingsService({
      dbPath: temp.dbPath,
    });
    await settingsService.updateSettings({
      responseLanguage: 'en',
    });
    const completionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish,
        latencyMs: 275,
      }),
      now,
      createId,
    });
    const optimizationOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return completionOrchestrator.completeOptimizedRun(input);
      },
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: optimizationOrchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo:
        [
          '지원 운영 인수인계 메모를 길게 정리해줘.',
          '현재 상태, 후속 조치, 리스크, 담당자 메모를 빠뜨리지 말아줘.',
          '숫자 42와 Talkin AI를 유지하고 체크리스트로 정리해줘.',
        ].join('\n'),
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    const completedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'completed' && feed.activeRun?.stage === 'completed',
      'completed run with estimated provider usage',
    );
    const usageRecord = await readUsageRecord(temp.dbPath, submitResult.runId);

    assert.equal(completedFeed.activeRun?.status, 'completed');
    assert.equal(completedFeed.runs[0]?.usage?.isEstimated, true);
    assert.equal(completedFeed.runs[0]?.usage?.latencyMs, 275);
    assert.equal(completedFeed.runs[0]?.usage?.savingsRate, completedFeed.activeRun?.usage?.savingsRate);
    assert.ok(usageRecord);
    assert.equal(usageRecord?.is_estimated, 1);
    assert.equal(usageRecord?.optimized_input_tokens, estimateTokenCount(optimizedEnglish));
    assert.equal(usageRecord?.output_tokens, estimateTokenCount(responseEnglish));
    assert.equal(usageRecord?.latency_ms, 275);
    assert.equal(usageRecord?.pricing_version, 'openai-gpt-4.1-2026-06');
    assert.ok(
      (usageRecord?.estimated_cost_without_optimization ?? 0) >
        (usageRecord?.estimated_cost_with_optimization ?? 0),
    );
  } finally {
    temp.cleanup();
  }
});

test('story-3.4:VAL-2 and story-3.4:SCOPE-1 restore failures keep the raw English artifact but fail the run before final message and usage commit', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T12:00:00.000Z');
  const createId = createDeterministicIdFactory();

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          return {
            optimizedEnglish:
              'Summarize the support plan. Preserve the checklist, the table, and the number 42.',
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse() {
          throw new TranslationMcpRuntimeError(
            'runtime_error',
            'forced restore failure',
          );
        },
      }),
    });
    const completionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService: createInMemoryAppSettingsService(defaultAppSettings),
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish:
          '| Item | Value |\n| --- | --- |\n| Budget | 42 |\n\n- [ ] Verify the checklist',
        usage: {
          inputTokens: 110,
          outputTokens: 54,
        },
        latencyMs: 620,
      }),
      now,
      createId,
    });
    const optimizationOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return completionOrchestrator.completeOptimizedRun(input);
      },
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: optimizationOrchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo:
        '고객 지원 운영 계획을 정리해줘.\n표와 체크리스트, 숫자 42를 꼭 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'balanced',
    });

    const failedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'failed' && feed.activeRun?.stage === 'failed',
      'failed run after restore failure',
    );
    const runRecord = await readRunRecord(temp.dbPath, submitResult.runId);
    const artifacts = await readRunArtifacts(temp.dbPath, submitResult.runId);
    const stages = await readRunStages(temp.dbPath, submitResult.runId);
    const messages = await readConversationMessages(temp.dbPath, submitResult.conversationId);
    const usageRecord = await readUsageRecord(temp.dbPath, submitResult.runId);

    assert.equal(failedFeed.activeRun?.status, 'failed');
    assert.equal(failedFeed.activeRun?.stage, 'failed');
    assert.equal(runRecord?.status, 'failed');
    assert.equal(runRecord?.error_code, 'local_restore_runtime_error');
    assert.deepEqual(
      stages.map((stage) => `${stage.stage}:${stage.status}`),
      [
        'queued:pending',
        'optimizing:running',
        'optimized:completed',
        'cloud_pending:running',
        'restoring:running',
        'failed:failed',
      ],
    );
    assert.deepEqual(
      artifacts.map((artifact) => artifact.artifact_type),
      ['optimized_prompt_en', 'preservation_check', 'provider_response_en'],
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(usageRecord, null);
  } finally {
    temp.cleanup();
  }
});

test('story-3.4:VAL-3 and story-3.4:AC-2 can finalize the raw English response directly when the configured response language is English', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T13:00:00.000Z');
  const createId = createDeterministicIdFactory();
  let restoreCallCount = 0;
  const directEnglishResponse =
    '1. Keep the 42 metric visible.\n2. Preserve the Talkin AI name.\n- [ ] Review the checklist.';

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          return {
            optimizedEnglish:
              'Write a short plan. Preserve the Talkin AI name, the 42 metric, and the checklist.',
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse() {
          restoreCallCount += 1;
          return {
            restoredKorean: '이 복원 호출은 실행되면 안 됩니다.',
          };
        },
      }),
    });
    const settingsService = createPersistentAppSettingsService({
      dbPath: temp.dbPath,
    });
    await settingsService.updateSettings({
      responseLanguage: 'en',
    });
    const completionOrchestrator = createPersistentResponseCompletionOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      settingsService,
      cloudInferenceGateway: createGateway({
        ok: true,
        provider: 'openai',
        model: 'gpt-4.1',
        responseEnglish: directEnglishResponse,
        usage: {
          inputTokens: 88,
          outputTokens: 34,
        },
        latencyMs: 410,
      }),
      now,
      createId,
    });
    const optimizationOrchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      dispatchOptimizedRun(input) {
        return completionOrchestrator.completeOptimizedRun(input);
      },
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: optimizationOrchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo: '영문 초안을 그대로 보고 싶어요.\n숫자 42와 Talkin AI는 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    const completedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'completed' && feed.activeRun?.stage === 'completed',
      'completed English-direct run',
    );
    const artifacts = await readRunArtifacts(temp.dbPath, submitResult.runId);
    const stages = await readRunStages(temp.dbPath, submitResult.runId);
    const messages = await readConversationMessages(temp.dbPath, submitResult.conversationId);
    const usageRecord = await readUsageRecord(temp.dbPath, submitResult.runId);

    assert.equal(completedFeed.activeRun?.status, 'completed');
    assert.equal(completedFeed.activeRun?.stage, 'completed');
    assert.equal(restoreCallCount, 0);
    assert.deepEqual(
      stages.map((stage) => `${stage.stage}:${stage.status}`),
      [
        'queued:pending',
        'optimizing:running',
        'optimized:completed',
        'cloud_pending:running',
        'completed:completed',
      ],
    );
    assert.deepEqual(
      artifacts.map((artifact) => artifact.artifact_type),
      ['optimized_prompt_en', 'preservation_check', 'provider_response_en'],
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.role, 'assistant');
    assert.equal(messages[1]?.content_ko, directEnglishResponse);
    assert.ok(usageRecord);
    assert.equal(usageRecord?.output_tokens, 34);
    assert.equal(usageRecord?.latency_ms, 410);
  } finally {
    temp.cleanup();
  }
});
