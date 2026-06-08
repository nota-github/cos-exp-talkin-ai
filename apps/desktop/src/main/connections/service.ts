import type {
  CloudModelId,
  ConnectionHealthResult,
  ConnectionStatusSummary,
  DeleteApiKeyResult,
  LocalEngineConnection,
  ProviderConnectionItem,
  ProviderId,
  SaveApiKeyResult,
} from '../../shared/ipc/contracts';
import {
  createInMemorySecretVault,
  createSecretService,
  providerSecretIds,
  type SecretService,
} from '../keychain/index.ts';
import type { FetchLike, FetchRequestInit } from '../providers/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
  type AppSettingsService,
} from '../settings/index.ts';
import type {
  TranslationEngineHealthState,
  TranslationMcpAdapter,
} from '../translation/index.ts';

type ProviderHealthProbeCode =
  | 'ok'
  | 'invalid_key'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'network'
  | 'unsupported';

type ProviderHealthProbeResult = {
  code: ProviderHealthProbeCode;
};

export interface ProviderHealthProbe {
  readonly provider: ProviderId;
  checkApiKey(apiKey: string): Promise<ProviderHealthProbeResult>;
}

export interface ConnectionHealthService {
  getConnectionHealth(): Promise<ConnectionHealthResult>;
  saveApiKey(input: { provider: ProviderId; apiKey: string }): Promise<SaveApiKeyResult>;
  deleteApiKey(input: { provider: ProviderId }): Promise<DeleteApiKeyResult>;
}

export type CreateConnectionHealthServiceOptions = {
  secretService?: SecretService;
  settingsService?: AppSettingsService;
  translationAdapter?: TranslationMcpAdapter | null;
  providerHealthProbes?: ProviderHealthProbe[];
  fetch?: FetchLike;
  now?: () => string;
  openaiModelsEndpoint?: string;
  anthropicModelsEndpoint?: string;
  googleModelsEndpoint?: string;
};

const providerLabels: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
};

const modelLabels: Record<CloudModelId, string> = {
  'gpt-4.1': 'GPT-4.1',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'gemini-1.5-pro': 'Gemini 1.5 Pro',
};

const selectedProviderByModel: Record<CloudModelId, ProviderId> = {
  'gpt-4.1': 'openai',
  'claude-sonnet-4': 'anthropic',
  'gemini-1.5-pro': 'google',
};

const providerDefaultModel: Record<ProviderId, CloudModelId> = {
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4',
  google: 'gemini-1.5-pro',
};

function resolveFetch(fetchOverride?: FetchLike) {
  if (fetchOverride) {
    return fetchOverride;
  }

  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime.');
  }

  return ((input: string, init?: FetchRequestInit) =>
    globalThis.fetch(input, init as RequestInit)) as FetchLike;
}

function buildStatus(
  label: ConnectionStatusSummary['label'],
  summary: string,
  guidance: string,
): ConnectionStatusSummary {
  return {
    state:
      label === '연결됨'
        ? 'connected'
        : label === '설정 필요'
          ? 'setup_required'
          : 'needs_attention',
    label,
    summary,
    guidance,
  };
}

function maskSecretPreview(secret: string) {
  const normalized = secret.trim();

  if (normalized.length <= 4) {
    return '••••';
  }

  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}••••${normalized.slice(-2)}`;
  }

  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
}

function createResponseCodeProbe(
  provider: ProviderId,
  request: (apiKey: string) => Promise<{
    ok: boolean;
    status: number;
  }>,
): ProviderHealthProbe {
  return {
    provider,
    async checkApiKey(apiKey) {
      try {
        const response = await request(apiKey);

        if (response.ok) {
          return {
            code: 'ok',
          };
        }

        if (response.status === 429) {
          return {
            code: 'rate_limited',
          };
        }

        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403
        ) {
          return {
            code: 'invalid_key',
          };
        }

        return {
          code:
            response.status >= 500 ? 'provider_unavailable' : 'provider_unavailable',
        };
      } catch {
        return {
          code: 'network',
        };
      }
    },
  };
}

export function createDefaultProviderHealthProbes(
  options: Omit<CreateConnectionHealthServiceOptions, 'secretService' | 'settingsService' | 'translationAdapter' | 'providerHealthProbes' | 'now'> = {},
) {
  const openaiModelsEndpoint =
    options.openaiModelsEndpoint ?? 'https://api.openai.com/v1/models';
  const anthropicModelsEndpoint =
    options.anthropicModelsEndpoint ?? 'https://api.anthropic.com/v1/models';
  const googleModelsEndpoint =
    options.googleModelsEndpoint ??
    'https://generativelanguage.googleapis.com/v1beta/models';

  return [
    createResponseCodeProbe('openai', async (apiKey) => {
      const fetchFn = resolveFetch(options.fetch);
      const response = await fetchFn(openaiModelsEndpoint, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      });

      return {
        ok: response.ok,
        status: response.status,
      };
    }),
    createResponseCodeProbe('anthropic', async (apiKey) => {
      const fetchFn = resolveFetch(options.fetch);
      const response = await fetchFn(anthropicModelsEndpoint, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      });

      return {
        ok: response.ok,
        status: response.status,
      };
    }),
    createResponseCodeProbe('google', async (apiKey) => {
      const fetchFn = resolveFetch(options.fetch);
      const response = await fetchFn(
        `${googleModelsEndpoint}?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'GET',
        },
      );

      return {
        ok: response.ok,
        status: response.status,
      };
    }),
  ] satisfies ProviderHealthProbe[];
}

function buildMissingKeyStatus(provider: ProviderId) {
  return buildStatus(
    '설정 필요',
    `${providerLabels[provider]} API 키가 아직 저장되지 않았습니다.`,
    '키를 붙여넣고 저장하면 다음 요청부터 바로 이 연결을 사용할 수 있습니다.',
  );
}

function buildStoredButUncheckedStatus(provider: ProviderId) {
  return buildStatus(
    '확인 필요',
    `${providerLabels[provider]} 키는 저장되어 있지만 현재 기본 모델에서 이 연결을 바로 점검하지 않았습니다.`,
    `이 제공자를 확인하려면 기본 모델을 ${modelLabels[providerDefaultModel[provider]]} 기준으로 바꾸고 연결 다시 확인을 누르세요.`,
  );
}

function buildSelectedProviderStatus(
  provider: ProviderId,
  probeCode: ProviderHealthProbeCode,
): ConnectionStatusSummary {
  switch (probeCode) {
    case 'ok':
      return buildStatus(
        '연결됨',
        `현재 기본 모델에 필요한 ${providerLabels[provider]} 연결이 정상입니다.`,
        '다음 한국어 요청부터 이 키가 바로 사용됩니다.',
      );
    case 'invalid_key':
      return buildStatus(
        '확인 필요',
        `${providerLabels[provider]} API 키를 확인하지 못했습니다.`,
        '키를 다시 붙여넣거나 새 키로 저장한 뒤 연결 다시 확인을 누르세요.',
      );
    case 'rate_limited':
      return buildStatus(
        '확인 필요',
        `${providerLabels[provider]}가 인증 후 사용량 제한을 보고했습니다.`,
        '잠시 후 다시 확인하거나 제공자 콘솔에서 사용량 한도를 확인하세요.',
      );
    case 'network':
      return buildStatus(
        '확인 필요',
        `${providerLabels[provider]} 연결을 현재 네트워크에서 확인하지 못했습니다.`,
        '인터넷 연결과 방화벽 설정을 확인한 뒤 다시 시도하세요.',
      );
    case 'unsupported':
      return buildStatus(
        '확인 필요',
        `${providerLabels[provider]} 키는 저장됐지만 자동 연결 점검은 아직 준비되지 않았습니다.`,
        '이 제공자를 기본 모델로 둔 뒤 실제 요청으로 연결을 확인하세요.',
      );
    case 'provider_unavailable':
      return buildStatus(
        '확인 필요',
        `${providerLabels[provider]}가 지금은 연결 점검에 응답하지 않습니다.`,
        '잠시 후 다시 확인하거나 다른 기본 모델로 전환해 작업을 계속하세요.',
      );
  }
}

function buildLocalEngineStatus(
  health: TranslationEngineHealthState | null,
): LocalEngineConnection {
  if (!health) {
    return {
      engineId: 'translation-mcp',
      label: '로컬 최적화 엔진',
      transport: 'unknown',
      lastCheckedAt: null,
      warnings: [],
      status: buildStatus(
        '확인 필요',
        '로컬 최적화 엔진 연결 구성이 아직 준비되지 않았습니다.',
        '앱이 translation MCP를 시작할 수 있는지 확인한 뒤 다시 열어 보세요.',
      ),
    };
  }

  if (health.status === 'ready') {
    return {
      engineId: health.engineId,
      label: '로컬 최적화 엔진',
      transport: health.transport,
      lastCheckedAt: health.checkedAt,
      warnings: health.warnings,
      status: buildStatus(
        '연결됨',
        '로컬 최적화 엔진이 응답했습니다.',
        '한국어 입력을 먼저 로컬에서 최적화한 뒤 클라우드 모델로 보낼 준비가 되어 있습니다.',
      ),
    };
  }

  const guidance =
    health.failureCode === 'sidecar_unreachable'
      ? 'translation MCP가 실행 중인지 확인하고 다시 확인하세요.'
      : health.failureCode === 'misconfigured'
        ? '엔진 실행 경로와 권한 설정을 확인한 뒤 다시 시도하세요.'
        : '잠시 후 다시 확인하거나 앱을 다시 시작해 주세요.';

  return {
    engineId: health.engineId,
    label: '로컬 최적화 엔진',
    transport: health.transport,
    lastCheckedAt: health.checkedAt,
    warnings: health.warnings,
    status: buildStatus(
      '확인 필요',
      health.status === 'degraded'
        ? '로컬 최적화 엔진이 불완전한 상태로 응답했습니다.'
        : '로컬 최적화 엔진이 지금 응답하지 않습니다.',
      guidance,
    ),
  };
}

function createProbeRegistry(probes: ProviderHealthProbe[]) {
  return new Map(probes.map((probe) => [probe.provider, probe]));
}

export function createConnectionHealthService(
  options: CreateConnectionHealthServiceOptions = {},
): ConnectionHealthService {
  const secretService =
    options.secretService ??
    createSecretService(createInMemorySecretVault());
  const settingsService =
    options.settingsService ??
    createInMemoryAppSettingsService(defaultAppSettings);
  const providerHealthProbes = createProbeRegistry(
    options.providerHealthProbes ?? createDefaultProviderHealthProbes(options),
  );
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async getConnectionHealth() {
      const settings = await settingsService.getSettings();
      const selectedProvider = selectedProviderByModel[settings.defaultModel];
      const checkedAt = now();
      const localEngineHealth = options.translationAdapter
        ? await options.translationAdapter.healthCheck()
        : null;
      const providers: ProviderConnectionItem[] = [];

      for (const provider of providerSecretIds) {
        const apiKey = (await secretService.getProviderApiKey(provider))?.trim() ?? '';
        const hasStoredKey = apiKey.length > 0;
        const isSelected = provider === selectedProvider;

        if (!hasStoredKey) {
          providers.push({
            provider,
            label: providerLabels[provider],
            defaultModel: providerDefaultModel[provider],
            isSelected,
            hasStoredKey: false,
            maskedKeyPreview: null,
            lastCheckedAt: null,
            status: buildMissingKeyStatus(provider),
          });
          continue;
        }

        if (!isSelected) {
          providers.push({
            provider,
            label: providerLabels[provider],
            defaultModel: providerDefaultModel[provider],
            isSelected: false,
            hasStoredKey: true,
            maskedKeyPreview: maskSecretPreview(apiKey),
            lastCheckedAt: null,
            status: buildStoredButUncheckedStatus(provider),
          });
          continue;
        }

        const probe = providerHealthProbes.get(provider);
        const probeResult: ProviderHealthProbeResult = probe
          ? await probe.checkApiKey(apiKey)
          : {
              code: 'unsupported',
            };

        providers.push({
          provider,
          label: providerLabels[provider],
          defaultModel: providerDefaultModel[provider],
          isSelected: true,
          hasStoredKey: true,
          maskedKeyPreview: maskSecretPreview(apiKey),
          lastCheckedAt: checkedAt,
          status: buildSelectedProviderStatus(provider, probeResult.code),
        });
      }

      return {
        selectedProvider,
        selectedModel: settings.defaultModel,
        providers,
        localEngine: buildLocalEngineStatus(localEngineHealth),
      };
    },

    async saveApiKey(input) {
      const normalized = input.apiKey.trim();

      if (normalized.length === 0) {
        throw new Error('API key must not be empty.');
      }

      await secretService.setProviderApiKey(input.provider, normalized);

      return {
        provider: input.provider,
        hasStoredKey: true,
        maskedKeyPreview: maskSecretPreview(normalized),
      };
    },

    async deleteApiKey(input) {
      await secretService.deleteProviderApiKey(input.provider);

      return {
        provider: input.provider,
        hasStoredKey: false,
        maskedKeyPreview: null,
      };
    },
  };
}
