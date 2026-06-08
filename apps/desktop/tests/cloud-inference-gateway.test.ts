import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createSecretService, createInMemorySecretVault } from '../src/main/keychain/index.ts';
import {
  createCloudInferenceGateway,
  createOpenAICloudProviderAdapter,
  type FetchRequestInit,
  type FetchResponseLike,
} from '../src/main/providers/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
} from '../src/main/settings/index.ts';
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

function createJsonResponse(status: number, payload: unknown): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

async function createGateway(overrides: {
  defaultModel?: typeof defaultAppSettings.defaultModel;
  fetchImpl?: (input: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;
}) {
  const secretService = createSecretService(createInMemorySecretVault());
  await secretService.setProviderApiKey('openai', 'sk-openai-test');

  return createCloudInferenceGateway({
    processType: 'browser',
    secretService,
    settingsService: createInMemoryAppSettingsService({
      ...defaultAppSettings,
      defaultModel: overrides.defaultModel ?? defaultAppSettings.defaultModel,
    }),
    adapters: [
      createOpenAICloudProviderAdapter({
        fetch: overrides.fetchImpl,
      }),
    ],
    nowMs: (() => {
      let value = 1_000;
      return () => {
        value += 50;
        return value;
      };
    })(),
  });
}

function listRendererSourceUrls(root: URL): URL[] {
  const urls: URL[] = [];

  for (const entry of readdirSync(root, {
    withFileTypes: true,
  })) {
    const nextUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, root);

    if (entry.isDirectory()) {
      urls.push(...listRendererSourceUrls(nextUrl));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      urls.push(nextUrl);
    }
  }

  return urls;
}

test('story-3.3:VAL-1 and story-3.3:AC-1 infer sends only optimized English to the provider payload', async () => {
  const sourceKorean =
    '사업계획서 초안을 세 단계로 정리하고 숫자 42와 Talkin AI를 그대로 유지해줘.';
  const optimizedEnglishPrompt =
    'Draft a three-step business-plan outline. Preserve the number 42 and the Talkin AI name.';
  const capturedRequests: Array<{
    url: string;
    body: {
      model: string;
      messages: Array<{
        role: string;
        content: string;
      }>;
      max_completion_tokens?: number;
    };
    headers: Record<string, string>;
  }> = [];
  const gateway = await createGateway({
    async fetchImpl(url, init) {
      capturedRequests.push({
        url,
        body: JSON.parse(String(init?.body ?? '{}')) as {
          model: string;
          messages: Array<{
            role: string;
            content: string;
          }>;
          max_completion_tokens?: number;
        },
        headers: init?.headers ?? {},
      });

      return createJsonResponse(200, {
        choices: [
          {
            message: {
              content: 'Here is the requested three-step business-plan outline.',
            },
          },
        ],
        usage: {
          prompt_tokens: 71,
          completion_tokens: 19,
          total_tokens: 90,
        },
      });
    },
  });

  const result = await gateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt,
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-4.1');
  assert.equal(
    result.responseEnglish,
    'Here is the requested three-step business-plan outline.',
  );
  assert.equal(result.usage?.inputTokens, 71);
  assert.equal(result.usage?.outputTokens, 19);
  assert.equal(result.usage?.totalTokens, 90);
  assert.equal(result.latencyMs, 50);
  assert.equal(capturedRequests.length, 1);
  assert.equal(capturedRequests[0]?.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(capturedRequests[0]?.headers.authorization, 'Bearer sk-openai-test');
  assert.equal(capturedRequests[0]?.body.model, 'gpt-4.1');
  assert.deepEqual(capturedRequests[0]?.body.messages, [
    {
      role: 'user',
      content: optimizedEnglishPrompt,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(capturedRequests[0]?.body), /[가-힣]/);
  assert.doesNotMatch(JSON.stringify(capturedRequests[0]?.body), new RegExp(sourceKorean));
});

test('story-3.3:AC-3 infer falls back to the default model setting when no model is provided', async () => {
  const capturedModels: string[] = [];
  const gateway = await createGateway({
    defaultModel: 'gpt-4.1',
    async fetchImpl(_url, init) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        model: string;
      };
      capturedModels.push(body.model);

      return createJsonResponse(200, {
        choices: [
          {
            message: {
              content: 'Summarized.',
            },
          },
        ],
      });
    },
  });

  const result = await gateway.infer({
    optimizedEnglishPrompt: 'Summarize the support incident in one paragraph.',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedModels, ['gpt-4.1']);
});

test('story-3.3:VAL-2 and story-3.3:SCOPE-3 infer normalizes auth, rate-limit, network, provider-unavailable, and invalid-request failures', async () => {
  const authGateway = await createGateway({
    async fetchImpl() {
      return createJsonResponse(401, {
        error: {
          message: 'Incorrect API key provided.',
        },
      });
    },
  });
  const rateLimitGateway = await createGateway({
    async fetchImpl() {
      return createJsonResponse(429, {
        error: {
          message: 'Rate limit exceeded.',
        },
      });
    },
  });
  const networkGateway = await createGateway({
    async fetchImpl() {
      throw new TypeError('fetch failed');
    },
  });
  const providerUnavailableGateway = await createGateway({
    async fetchImpl() {
      return createJsonResponse(503, {
        error: {
          message: 'Service unavailable.',
        },
      });
    },
  });
  let invalidRequestFetchCount = 0;
  const invalidRequestGateway = await createGateway({
    async fetchImpl() {
      invalidRequestFetchCount += 1;
      return createJsonResponse(200, {
        choices: [
          {
            message: {
              content: 'Should not be called.',
            },
          },
        ],
      });
    },
  });

  const authResult = await authGateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt: 'Explain the retention plan.',
  });
  const rateLimitResult = await rateLimitGateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt: 'Explain the retention plan.',
  });
  const networkResult = await networkGateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt: 'Explain the retention plan.',
  });
  const providerUnavailableResult = await providerUnavailableGateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt: 'Explain the retention plan.',
  });
  const invalidRequestResult = await invalidRequestGateway.infer({
    model: 'gpt-4.1',
    optimizedEnglishPrompt: '   ',
  });

  assert.deepEqual(
    [
      authResult,
      rateLimitResult,
      networkResult,
      providerUnavailableResult,
      invalidRequestResult,
    ].map((result) => (result.ok ? 'success' : result.code)),
    ['auth', 'rate_limit', 'network', 'provider_unavailable', 'invalid_request'],
  );

  assert.equal(authResult.ok, false);
  if (!authResult.ok) {
    assert.match(authResult.message, /인증/);
    assert.match(authResult.guidance, /API 키/);
    assert.equal(authResult.retryable, false);
    assert.equal(authResult.status, 401);
  }

  assert.equal(rateLimitResult.ok, false);
  if (!rateLimitResult.ok) {
    assert.match(rateLimitResult.message, /한도/);
    assert.equal(rateLimitResult.retryable, true);
    assert.equal(rateLimitResult.status, 429);
  }

  assert.equal(networkResult.ok, false);
  if (!networkResult.ok) {
    assert.match(networkResult.message, /네트워크/);
    assert.equal(networkResult.retryable, true);
    assert.equal(networkResult.status, undefined);
  }

  assert.equal(providerUnavailableResult.ok, false);
  if (!providerUnavailableResult.ok) {
    assert.match(providerUnavailableResult.message, /응답하지 않습니다/);
    assert.equal(providerUnavailableResult.retryable, true);
    assert.equal(providerUnavailableResult.status, 503);
  }

  assert.equal(invalidRequestResult.ok, false);
  if (!invalidRequestResult.ok) {
    assert.match(invalidRequestResult.guidance, /프롬프트/);
    assert.equal(invalidRequestResult.retryable, false);
  }
  assert.equal(invalidRequestFetchCount, 0);
});

test('story-3.3:VAL-3 and story-3.3:AC-2 provider calls stay out of renderer code paths', () => {
  const secretService = createSecretService(createInMemorySecretVault());

  assert.throws(
    () =>
      createCloudInferenceGateway({
        processType: 'renderer',
        secretService,
      }),
    /main process/i,
  );

  const api = createTalkinAIDesktopApi(createNoopIpcRenderer(), {
    channel: 'desktop-shell',
    platform: 'darwin',
  });
  const client = createRendererDesktopClient(api);

  assert.equal('cloudInferenceGateway' in api, false);
  assert.equal('cloudInferenceGateway' in api.ipc, false);
  assert.equal('cloudInferenceGateway' in client, false);
  assert.ok(commandNames.every((name) => !/infer|provider|cloud/i.test(name)));
  assert.ok(queryNames.every((name) => !/infer|provider|cloud/i.test(name)));

  const rendererSources = listRendererSourceUrls(new URL('../src/renderer/', import.meta.url));
  const suspiciousEntries = rendererSources
    .map((url) => ({
      path: url.pathname,
      content: readFileSync(url, 'utf8'),
    }))
    .filter(({ content }) =>
      /(fetch\s*\(|axios|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|https?\s*\.\s*request|XMLHttpRequest)/.test(
        content,
      ),
    )
    .map(({ path }) => path);

  assert.deepEqual(suspiciousEntries, []);
});
