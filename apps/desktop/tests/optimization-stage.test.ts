import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentChatHistoryService } from '../src/main/chat/index.ts';
import { openSqliteDatabase } from '../src/main/persistence/database.ts';
import {
  TranslationMcpRuntimeError,
  createFakeTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from '../src/main/translation/index.ts';
import { createPersistentOptimizationStageOrchestrator } from '../src/main/workflows/index.ts';

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-optimization-stage-'));
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

function createSequentialNow(startIso = '2026-06-08T09:00:00.000Z') {
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

async function readConversationSummary(dbPath: string, conversationId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    const rows = await handle.connection.query<{ summary: string | null }>(`
      SELECT summary
      FROM conversations
      WHERE id = '${conversationId}';
    `);

    return rows[0]?.summary ?? null;
  } finally {
    await handle.close();
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

test('story-3.2:VAL-1 and story-3.2:AC-4 forwards every optimization mode with the stored conversation summary', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T09:30:00.000Z');
  const createId = createDeterministicIdFactory();
  const capturedInputs: Array<{
    mode: string;
    sourceKorean: string;
    conversationSummary?: string;
    outputHints?: string[];
    namedEntities?: string[];
  }> = [];

  try {
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
    });
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt(input) {
          capturedInputs.push({
            mode: input.mode,
            sourceKorean: input.sourceKorean,
            conversationSummary: input.conversationSummary,
            outputHints: input.outputHints,
            namedEntities: input.namedEntities,
          });

          return {
            optimizedEnglish: `mode=${input.mode}; summarize=${input.conversationSummary ?? 'none'}`,
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
      }),
    });
    const orchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
    });
    const modes = ['balanced', 'savings', 'quality', 'long_context'] as const;
    const summaries: string[] = [];

    for (const mode of modes) {
      const promptKo = `${mode} 모드로 사업계획서 초안을 정리해줘.\n표와 체크리스트는 유지하고 Talkin AI 숫자 42를 그대로 남겨줘.`;
      const submitResult = await chatHistoryService.submitPrompt({
        promptKo,
        selectedModel: 'gpt-4.1',
        optimizationMode: mode,
      });

      summaries.push((await readConversationSummary(temp.dbPath, submitResult.conversationId)) ?? '');

      const result = await orchestrator.optimizeQueuedRun({
        runId: submitResult.runId,
      });
      assert.equal(result.status, 'optimized');
    }

    assert.deepEqual(
      capturedInputs.map((input) => input.mode),
      ['default', 'cost_saver', 'quality', 'long_context'],
    );
    assert.deepEqual(
      capturedInputs.map((input) => input.conversationSummary ?? ''),
      summaries,
    );
    assert.ok(
      capturedInputs.every((input) => input.sourceKorean.includes('Talkin AI 숫자 42')),
    );
    assert.ok(
      capturedInputs.every(
        (input) =>
          (input.outputHints?.length ?? 0) > 0 &&
          (input.namedEntities ?? []).includes('Talkin AI'),
      ),
    );
  } finally {
    temp.cleanup();
  }
});

test('story-3.2:VAL-2 and story-3.2:AC-2 successful optimization stores artifacts and persisted run stages', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T10:00:00.000Z');
  const createId = createDeterministicIdFactory();

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt(input) {
          return {
            optimizedEnglish:
              'Create a Korea market-entry outline. Preserve the table, checklist, every number, and the Talkin AI entity.',
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
            notes: [`summary=${input.conversationSummary ?? 'none'}`],
          };
        },
      }),
    });
    const orchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: orchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo:
        '한국 시장 진출 사업계획서를 정리해줘.\nTalkin AI와 숫자 42는 그대로 두고 표와 체크리스트 형식을 유지해줘.',
      selectedModel: 'claude-sonnet-4',
      optimizationMode: 'quality',
    });

    const optimizedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'optimized' && feed.activeRun?.stage === 'optimized',
      'optimized run state after background local optimization',
    );
    const runRecord = await readRunRecord(temp.dbPath, submitResult.runId);
    const stages = await readRunStages(temp.dbPath, submitResult.runId);
    const artifacts = await readRunArtifacts(temp.dbPath, submitResult.runId);
    const preservationArtifact = artifacts.find(
      (artifact) => artifact.artifact_type === 'preservation_check',
    );
    const parsedPreservationArtifact = JSON.parse(preservationArtifact?.content ?? '{}');

    assert.equal(optimizedFeed.activeRun?.status, 'optimized');
    assert.equal(optimizedFeed.activeRun?.stage, 'optimized');
    assert.equal(runRecord?.status, 'optimized');
    assert.equal(runRecord?.error_code, null);
    assert.deepEqual(
      stages.map((stage) => `${stage.stage}:${stage.status}`),
      ['queued:pending', 'optimizing:running', 'optimized:completed'],
    );
    assert.deepEqual(
      artifacts.map((artifact) => artifact.artifact_type),
      ['optimized_prompt_en', 'preservation_check'],
    );
    assert.equal(artifacts[0]?.visibility, 'advanced');
    assert.ok((artifacts[0]?.token_estimate ?? 0) > 0);
    assert.ok(preservationArtifact);
    assert.deepEqual(
      parsedPreservationArtifact.preservationChecks,
      {
        entitiesPreserved: true,
        constraintsPreserved: true,
        outputFormatPreserved: true,
      },
    );
    assert.equal(parsedPreservationArtifact.mode, 'quality');
    assert.ok(Array.isArray(parsedPreservationArtifact.outputHints));
    assert.ok(Array.isArray(parsedPreservationArtifact.namedEntities));
    assert.equal('preservationInput' in parsedPreservationArtifact, false);
  } finally {
    temp.cleanup();
  }
});

test('story-3.2:VAL-3 and story-3.2:AC-3 local optimization failures mark the run failed and do not call the cloud handoff seam', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T10:30:00.000Z');
  const createId = createDeterministicIdFactory();
  let cloudDispatchCalls = 0;

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          throw new TranslationMcpRuntimeError(
            'runtime_error',
            'forced local optimization failure',
          );
        },
      }),
    });
    const orchestrator = createPersistentOptimizationStageOrchestrator({
      dbPath: temp.dbPath,
      translationAdapter,
      now,
      createId,
      async dispatchOptimizedRun() {
        cloudDispatchCalls += 1;
      },
    });
    const chatHistoryService = createPersistentChatHistoryService({
      dbPath: temp.dbPath,
      now,
      createId,
      optimizationStageOrchestrator: orchestrator,
    });
    const submitResult = await chatHistoryService.submitPrompt({
      promptKo:
        '긴 문서 요약 요청입니다.\n원문 숫자와 체크리스트를 보존해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'savings',
    });

    const failedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: submitResult.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'failed' && feed.activeRun?.stage === 'failed',
      'failed run state after background local optimization failure',
    );
    const runRecord = await readRunRecord(temp.dbPath, submitResult.runId);
    const stages = await readRunStages(temp.dbPath, submitResult.runId);
    const artifacts = await readRunArtifacts(temp.dbPath, submitResult.runId);

    assert.equal(failedFeed.activeRun?.status, 'failed');
    assert.equal(failedFeed.activeRun?.stage, 'failed');
    assert.equal(runRecord?.status, 'failed');
    assert.equal(runRecord?.error_code, 'local_optimization_runtime_error');
    assert.deepEqual(
      stages.map((stage) => `${stage.stage}:${stage.status}`),
      ['queued:pending', 'optimizing:running', 'failed:failed'],
    );
    assert.equal(cloudDispatchCalls, 0);
    assert.deepEqual(artifacts, []);
  } finally {
    temp.cleanup();
  }
});
