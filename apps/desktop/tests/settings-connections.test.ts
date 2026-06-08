import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectionHealthService, type ProviderHealthProbe } from '../src/main/connections/index.ts';
import { createDesktopIpcService } from '../src/main/ipc/register-ipc.ts';
import { createInMemorySecretVault, createSecretService } from '../src/main/keychain/index.ts';
import type {
  TranslationEngineHealthState,
  TranslationMcpAdapter,
} from '../src/main/translation/index.ts';

function createFakeTranslationAdapter(
  health: TranslationEngineHealthState,
): TranslationMcpAdapter {
  return {
    engineId: health.engineId,
    transport: health.transport,
    async healthCheck() {
      return health;
    },
    async optimizePrompt() {
      throw new Error('not used in settings connection tests');
    },
    async restoreResponse() {
      throw new Error('not used in settings connection tests');
    },
    async summarizeConversationContext() {
      throw new Error('not used in settings connection tests');
    },
  };
}

function createProviderHealthProbes(
  outcomeByKey: Record<string, 'ok' | 'invalid_key' | 'provider_unavailable'>,
) {
  return (['openai', 'anthropic', 'google'] as const).map((provider) => ({
    provider,
    async checkApiKey(apiKey: string) {
      return {
        code: outcomeByKey[apiKey] ?? 'provider_unavailable',
      };
    },
  })) satisfies ProviderHealthProbe[];
}

test('story-6.2:VAL-1, story-6.2:AC-1, and story-6.2:AC-3 distinguish missing, invalid, and valid selected-provider keys', async () => {
  const secretService = createSecretService(createInMemorySecretVault());
  const translationAdapter = createFakeTranslationAdapter({
    status: 'ready',
    checkedAt: '2026-06-09T10:00:00.000Z',
    engineId: 'translation-mcp',
    transport: 'fake',
    failureCode: 'none',
    message: 'ready',
    warnings: [],
    meta: {
      latencyMs: 12,
      version: '0.3.1-dev',
    },
  });
  const service = createDesktopIpcService({
    secretService,
    connectionHealthService: createConnectionHealthService({
      now: () => '2026-06-09T10:01:00.000Z',
      providerHealthProbes: createProviderHealthProbes({
        'sk-openai-valid-1234': 'ok',
        'sk-openai-invalid-1234': 'invalid_key',
      }),
      secretService,
      translationAdapter,
    }),
  });

  const missingKeyHealth = await service.queries.getConnectionHealth({});
  await service.commands.saveApiKey({
    provider: 'openai',
    apiKey: 'sk-openai-invalid-1234',
  });
  const invalidKeyHealth = await service.queries.getConnectionHealth({});
  const saveValidResult = await service.commands.saveApiKey({
    provider: 'openai',
    apiKey: 'sk-openai-valid-1234',
  });
  const validKeyHealth = await service.queries.getConnectionHealth({});
  await service.commands.saveApiKey({
    provider: 'anthropic',
    apiKey: 'sk-anthropic-prepared-4321',
  });
  const preparedSecondaryProviderHealth = await service.queries.getConnectionHealth({});

  assert.equal(missingKeyHealth.selectedProvider, 'openai');
  assert.equal(missingKeyHealth.providers[0].status.label, '설정 필요');
  assert.match(missingKeyHealth.providers[0].status.guidance, /저장/);
  assert.equal(missingKeyHealth.localEngine.status.label, '연결됨');

  assert.equal(invalidKeyHealth.providers[0].status.label, '확인 필요');
  assert.match(invalidKeyHealth.providers[0].status.summary, /API 키/);
  assert.match(invalidKeyHealth.providers[0].status.guidance, /다시/);

  assert.equal(saveValidResult.provider, 'openai');
  assert.equal(saveValidResult.hasStoredKey, true);
  assert.equal(saveValidResult.maskedKeyPreview.includes('sk-openai-valid-1234'), false);
  assert.equal(validKeyHealth.providers[0].status.label, '연결됨');
  assert.match(validKeyHealth.providers[0].status.summary, /정상/);

  const anthropicEntry = preparedSecondaryProviderHealth.providers.find(
    (item) => item.provider === 'anthropic',
  );

  assert.equal(anthropicEntry?.hasStoredKey, true);
  assert.equal(anthropicEntry?.status.label, '확인 필요');
  assert.match(anthropicEntry?.status.summary ?? '', /저장/);
});

test('story-6.2:VAL-3 and story-6.2:AC-4 show local-engine recovery guidance without blocking the rest of settings', async () => {
  const secretService = createSecretService(createInMemorySecretVault());
  const translationAdapter = createFakeTranslationAdapter({
    status: 'unavailable',
    checkedAt: '2026-06-09T10:05:00.000Z',
    engineId: 'translation-mcp',
    transport: 'stdio',
    failureCode: 'sidecar_unreachable',
    message: 'sidecar not reachable',
    warnings: [],
    meta: {
      latencyMs: 240,
    },
  });
  const service = createDesktopIpcService({
    secretService,
    connectionHealthService: createConnectionHealthService({
      now: () => '2026-06-09T10:06:00.000Z',
      providerHealthProbes: createProviderHealthProbes({}),
      secretService,
      translationAdapter,
    }),
  });

  const health = await service.queries.getConnectionHealth({});
  const deleteResult = await service.commands.deleteApiKey({
    provider: 'openai',
  });

  assert.equal(health.localEngine.status.label, '확인 필요');
  assert.match(health.localEngine.status.summary, /응답하지 않습니다|불완전/);
  assert.match(health.localEngine.status.guidance, /translation MCP/);
  assert.equal(health.providers[0].status.label, '설정 필요');
  assert.deepEqual(deleteResult, {
    provider: 'openai',
    hasStoredKey: false,
    maskedKeyPreview: null,
  });
});
