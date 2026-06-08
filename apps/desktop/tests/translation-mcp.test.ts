import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import {
  createFakeTranslationMcpRuntime,
  createStdioTranslationMcpRuntime,
  createTranslationMcpAdapter,
} from '../src/main/translation/index.ts';
import { createTalkinAIDesktopApi } from '../src/preload/bridge.ts';
import { createRendererDesktopClient } from '../src/renderer/lib/ipc/client.ts';
import { commandNames, queryNames } from '../src/shared/ipc/contracts.ts';

function createNoopIpcRenderer() {
  return {
    invoke: async () => undefined,
    on: () => undefined,
    off: () => undefined,
  };
}

test('story-3.1:VAL-1 and story-3.1:AC-1 fake runtime supports main-process health, summarize, optimize, and restore calls', async () => {
  const capturedRequests: Array<{
    method: string;
    payload: unknown;
  }> = [];
  const preservation = {
    namedEntities: ['Talkin AI', 'Claude Sonnet'],
    requiredConstraints: ['Keep a 3-step checklist', 'Preserve every number'],
    outputFormat: 'markdown checklist',
    preserveStructure: ['checklists', 'headings'],
    preserveNumericLiterals: true,
  } as const;
  const translationAdapter = createTranslationMcpAdapter({
    processType: 'browser',
    now: () => '2026-06-08T10:00:00.000Z',
    runtime: createFakeTranslationMcpRuntime({
      async healthCheck() {
        return {
          ok: true,
          engineId: 'translation-mcp',
          version: '0.3.1-dev',
          message: 'ready',
        };
      },
      async summarizeConversationContext(input) {
        capturedRequests.push({
          method: 'summarizeConversationContext',
          payload: input,
        });

        return {
          summary: 'User needs a preserved markdown checklist in English prompt form.',
        };
      },
      async optimizePrompt(input) {
        capturedRequests.push({
          method: 'optimizePrompt',
          payload: input,
        });

        return {
          optimizedEnglish:
            'Create a 3-step markdown checklist for the business proposal. Preserve every number and named entity.',
          preservationChecks: {
            namedEntitiesPreserved: true,
            constraintsPreserved: true,
            outputFormatPreserved: true,
          },
          notes: ['Named entities preserved'],
        };
      },
      async restoreResponse(input) {
        capturedRequests.push({
          method: 'restoreResponse',
          payload: input,
        });

        return {
          restoredKorean:
            '사업 제안서를 위한 3단계 마크다운 체크리스트입니다. 고유명사와 숫자는 그대로 유지했습니다.',
        };
      },
    }),
  });
  const service = createDesktopIpcService({
    translationAdapter,
  });

  assert.equal(service.translationAdapter, translationAdapter);

  const health = await service.translationAdapter?.healthCheck();
  const summary = await service.translationAdapter?.summarizeConversationContext({
    turns: [
      {
        role: 'user',
        content: '사업 제안서를 세 단계 체크리스트로 정리해줘.',
        language: 'ko',
      },
      {
        role: 'assistant',
        content: '대상 산업과 마감일도 포함할까요?',
        language: 'ko',
      },
    ],
    mode: 'quality',
    preservation,
    maxSummaryCharacters: 180,
  });
  const optimized = await service.translationAdapter?.optimizePrompt({
    sourceKorean: '사업 제안서를 세 단계 체크리스트로 정리해줘. 숫자와 고유명사는 유지해줘.',
    mode: 'quality',
    conversationSummary: summary?.summary,
    preservation,
  });
  const restored = await service.translationAdapter?.restoreResponse({
    sourceKorean: '사업 제안서를 세 단계 체크리스트로 정리해줘. 숫자와 고유명사는 유지해줘.',
    optimizedEnglish: optimized?.optimizedEnglish ?? '',
    cloudEnglishResponse:
      '1. Define the proposal goal.\n2. Preserve all numbers.\n3. Keep the named entities unchanged.',
    mode: 'quality',
    preservation,
  });

  assert.equal(health?.status, 'ready');
  assert.equal(health?.failureCode, 'none');
  assert.equal(health?.transport, 'fake');
  assert.equal(health?.engineId, 'translation-mcp');
  assert.equal(health?.meta.version, '0.3.1-dev');
  assert.equal(
    summary?.summary,
    'User needs a preserved markdown checklist in English prompt form.',
  );
  assert.match(optimized?.optimizedEnglish ?? '', /markdown checklist/i);
  assert.equal(optimized?.preservationChecks.namedEntitiesPreserved, true);
  assert.match(restored?.restoredKorean ?? '', /3단계 마크다운 체크리스트/);
  assert.deepEqual(
    capturedRequests.map((entry) => entry.method),
    ['summarizeConversationContext', 'optimizePrompt', 'restoreResponse'],
  );
  assert.equal(
    (capturedRequests[0]?.payload as { mode: string }).mode,
    'quality',
  );
  assert.deepEqual(
    (capturedRequests[1]?.payload as { preservation: typeof preservation }).preservation,
    preservation,
  );
  assert.equal(
    (capturedRequests[2]?.payload as { mode: string }).mode,
    'quality',
  );
});

test('story-3.1:VAL-2 and story-3.1:AC-4 adapter creation is blocked in renderer context and not exposed through the renderer bridge', () => {
  const runtime = createFakeTranslationMcpRuntime({
    async healthCheck() {
      return {
        ok: true,
      };
    },
  });

  assert.throws(
    () =>
      createTranslationMcpAdapter({
        processType: 'renderer',
        runtime,
      }),
    /main process/i,
  );

  const api = createTalkinAIDesktopApi(createNoopIpcRenderer(), {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);

  assert.equal('translationAdapter' in api, false);
  assert.equal('translationAdapter' in api.ipc, false);
  assert.equal('translationAdapter' in client, false);
  assert.ok(commandNames.every((name) => !name.toLowerCase().includes('translation')));
  assert.ok(queryNames.every((name) => !name.toLowerCase().includes('translation')));
});

test('story-3.1:VAL-3 and story-3.1:AC-3 sidecar-down health checks return an unavailable stdio-local result', async () => {
  const translationAdapter = createTranslationMcpAdapter({
    processType: 'browser',
    now: () => '2026-06-08T10:10:00.000Z',
    runtime: createStdioTranslationMcpRuntime({
      command: join(tmpdir(), 'talkin-ai-missing-translation-sidecar'),
      timeoutMs: 250,
    }),
  });

  const health = await translationAdapter.healthCheck();

  assert.equal(health.status, 'unavailable');
  assert.equal(health.transport, 'stdio');
  assert.equal(health.failureCode, 'sidecar_unreachable');
  assert.match(health.message, /could not be started/i);
});
