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

function createTempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-retry-run-'));
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

function createSequentialNow(startIso = '2026-06-08T15:00:00.000Z') {
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

async function readConversationMessages(dbPath: string, conversationId: string) {
  const handle = await openSqliteDatabase(dbPath);

  try {
    return await handle.connection.query<{
      id: string;
      role: string;
      content_ko: string;
      run_id: string | null;
    }>(`
      SELECT id, role, content_ko, run_id
      FROM messages
      WHERE conversation_id = '${conversationId}'
      ORDER BY created_at ASC, rowid ASC;
    `);
  } finally {
    await handle.close();
  }
}

async function readConversationRuns(dbPath: string, conversationId: string) {
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

function createGateway(
  result: Awaited<ReturnType<CloudInferenceGateway['infer']>>,
): CloudInferenceGateway {
  return {
    async infer() {
      return result;
    },
  };
}

test('story-3.5:VAL-3, story-3.5:AC-3, and story-3.5:AC-4 retryRun creates a new run from the same Korean source message while preserving earlier successful replies', async () => {
  const temp = createTempDatabase();
  const now = createSequentialNow('2026-06-08T15:00:00.000Z');
  const createId = createDeterministicIdFactory();
  let failOptimization = false;

  try {
    const translationAdapter = createTranslationMcpAdapter({
      processType: 'browser',
      runtime: createFakeTranslationMcpRuntime({
        async optimizePrompt() {
          if (failOptimization) {
            throw new TranslationMcpRuntimeError(
              'runtime_error',
              'forced retry optimization failure',
            );
          }

          return {
            optimizedEnglish:
              'Summarize the support workflow. Preserve the checklist, the 42 metric, and the Talkin AI name.',
            preservationChecks: {
              entitiesPreserved: true,
              constraintsPreserved: true,
              outputFormatPreserved: true,
            },
          };
        },
        async restoreResponse() {
          return {
            restoredKorean:
              '지원 운영 흐름을 요약했습니다.\n- [ ] 체크리스트 유지\n- [ ] 숫자 42 유지\n- [ ] Talkin AI 유지',
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
        responseEnglish:
          'Support workflow summary\n- [ ] Keep the checklist\n- [ ] Preserve the 42 metric\n- [ ] Preserve Talkin AI',
        usage: {
          inputTokens: 84,
          outputTokens: 52,
        },
        latencyMs: 520,
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
    const initialSubmit = await chatHistoryService.submitPrompt({
      promptKo:
        '지원 운영 흐름을 요약해줘.\n체크리스트와 숫자 42, Talkin AI는 그대로 유지해줘.',
      selectedModel: 'gpt-4.1',
      optimizationMode: 'quality',
    });

    const completedFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: initialSubmit.conversationId,
        }),
      (feed) => feed.activeRun?.status === 'completed' && feed.messages.length === 2,
      'completed source run before retry',
    );

    failOptimization = true;

    const retryResult = await chatHistoryService.retryRun({
      runId: initialSubmit.runId,
    });
    const failedRetryFeed = await waitFor(
      () =>
        chatHistoryService.getChatFeed({
          conversationId: initialSubmit.conversationId,
        }),
      (feed) =>
        feed.activeRun?.runId === retryResult.runId &&
        feed.activeRun?.status === 'failed' &&
        feed.activeRun?.sourceMessageId === initialSubmit.messageId,
      'failed retry run with preserved source message',
    );
    const messages = await readConversationMessages(temp.dbPath, initialSubmit.conversationId);
    const runs = await readConversationRuns(temp.dbPath, initialSubmit.conversationId);

    assert.equal(retryResult.acceptedStatus, 'queued');
    assert.notEqual(retryResult.runId, initialSubmit.runId);
    assert.equal(completedFeed.messages[0]?.contentKo, messages[0]?.content_ko);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[0]?.content_ko, '지원 운영 흐름을 요약해줘.\n체크리스트와 숫자 42, Talkin AI는 그대로 유지해줘.');
    assert.equal(messages[1]?.role, 'assistant');
    assert.match(messages[1]?.content_ko ?? '', /Talkin AI 유지/);
    assert.equal(failedRetryFeed.activeRun?.runId, retryResult.runId);
    assert.equal(failedRetryFeed.activeRun?.status, 'failed');
    assert.equal(failedRetryFeed.activeRun?.sourceMessageId, initialSubmit.messageId);
    assert.equal(failedRetryFeed.messages.length, 2);
    assert.deepEqual(
      runs.map((run) => ({
        id: run.id,
        messageId: run.message_id,
        status: run.status,
      })),
      [
        {
          id: initialSubmit.runId,
          messageId: initialSubmit.messageId,
          status: 'completed',
        },
        {
          id: retryResult.runId,
          messageId: initialSubmit.messageId,
          status: 'failed',
        },
      ],
    );
    assert.equal(runs[1]?.error_code, 'local_optimization_runtime_error');
  } finally {
    temp.cleanup();
  }
});
