import type { CloudModelId } from '../../shared/ipc/contracts';
import type { SecretService } from '../keychain/index.ts';
import type { ProviderId } from '../persistence/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
  type AppSettingsService,
} from '../settings/index.ts';

export type CloudInferenceFailureCode =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'provider_unavailable'
  | 'invalid_request';

export type InferOptimizedPromptInput = {
  optimizedEnglishPrompt: string;
  model?: CloudModelId;
  maxOutputTokens?: number;
  systemInstructionEn?: string;
};

export type CloudInferenceUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CloudInferenceSuccess = {
  ok: true;
  provider: ProviderId;
  model: CloudModelId;
  responseEnglish: string;
  latencyMs: number;
  usage?: CloudInferenceUsage;
};

export type CloudInferenceFailure = {
  ok: false;
  provider: ProviderId;
  model: CloudModelId;
  code: CloudInferenceFailureCode;
  message: string;
  guidance: string;
  retryable: boolean;
  status?: number;
};

export type CloudInferenceResult = CloudInferenceSuccess | CloudInferenceFailure;

export type ProviderInferInput = {
  model: CloudModelId;
  optimizedEnglishPrompt: string;
  apiKey: string;
  maxOutputTokens?: number;
  systemInstructionEn?: string;
};

export type ProviderInferSuccess = {
  responseEnglish: string;
  usage?: CloudInferenceUsage;
};

export type FetchRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type FetchResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchLike = (
  input: string,
  init?: FetchRequestInit,
) => Promise<FetchResponseLike>;

export interface CloudProviderAdapter {
  readonly provider: ProviderId;
  supportsModel(model: CloudModelId): boolean;
  infer(input: ProviderInferInput): Promise<ProviderInferSuccess>;
}

export interface CloudInferenceGateway {
  infer(input: InferOptimizedPromptInput): Promise<CloudInferenceResult>;
}

export type CreateCloudInferenceGatewayOptions = {
  secretService: SecretService;
  adapters?: CloudProviderAdapter[];
  settingsService?: AppSettingsService;
  processType?: string;
  nowMs?: () => number;
};

export type CreateOpenAICloudProviderAdapterOptions = {
  endpoint?: string;
  fetch?: FetchLike;
};

type FailureTemplate = {
  message: string;
  guidance: string;
  retryable: boolean;
};

const providerByModel: Record<CloudModelId, ProviderId> = {
  'gpt-4.1': 'openai',
  'claude-sonnet-4': 'anthropic',
  'gemini-1.5-pro': 'google',
};

const providerLabels: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
};

class CloudProviderHttpError extends Error {
  readonly provider: ProviderId;
  readonly status: number;

  constructor(provider: ProviderId, status: number, message: string) {
    super(message);
    this.name = 'CloudProviderHttpError';
    this.provider = provider;
    this.status = status;
  }
}

class CloudProviderNetworkError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CloudProviderNetworkError';
    this.provider = provider;

    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

class CloudProviderProtocolError extends Error {
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CloudProviderProtocolError';
    this.provider = provider;

    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function ensureMainProcess(
  processType = (process as NodeJS.Process & { type?: string }).type,
) {
  if (processType === 'renderer') {
    throw new Error(
      'Talkin AI cloud inference gateway can only be created in the Electron main process.',
    );
  }
}

function nowInMilliseconds() {
  return Date.now();
}

function buildFailureTemplate(
  code: CloudInferenceFailureCode,
  provider: ProviderId,
): FailureTemplate {
  const providerLabel = providerLabels[provider];

  switch (code) {
    case 'auth':
      return {
        message: `${providerLabel} 인증에 실패했습니다.`,
        guidance: `설정에서 ${providerLabel} API 키 연결 상태를 확인하세요.`,
        retryable: false,
      };
    case 'rate_limit':
      return {
        message: `${providerLabel} 요청 한도에 도달했습니다.`,
        guidance: '잠시 후 다시 시도하거나 사용량 한도를 확인하세요.',
        retryable: true,
      };
    case 'network':
      return {
        message: `${providerLabel} 호출 중 네트워크 오류가 발생했습니다.`,
        guidance: '인터넷 연결과 방화벽 설정을 확인한 뒤 다시 시도하세요.',
        retryable: true,
      };
    case 'provider_unavailable':
      return {
        message: `${providerLabel} 제공자가 현재 응답하지 않습니다.`,
        guidance: '잠시 후 다시 시도하거나 제공자 상태를 확인하세요.',
        retryable: true,
      };
    case 'invalid_request':
      return {
        message: '클라우드 모델에 보낼 요청 형식을 확인할 수 없습니다.',
        guidance: '프롬프트 내용과 모델 설정을 확인한 뒤 다시 시도하세요.',
        retryable: false,
      };
  }
}

function buildFailure(
  provider: ProviderId,
  model: CloudModelId,
  code: CloudInferenceFailureCode,
  status?: number,
): CloudInferenceFailure {
  const template = buildFailureTemplate(code, provider);

  return {
    ok: false,
    provider,
    model,
    code,
    message: template.message,
    guidance: template.guidance,
    retryable: template.retryable,
    status,
  };
}

function normalizeProviderFailure(
  error: unknown,
  context: {
    provider: ProviderId;
    model: CloudModelId;
  },
): CloudInferenceFailure {
  if (error instanceof CloudProviderHttpError) {
    if (error.status === 401 || error.status === 403) {
      return buildFailure(context.provider, context.model, 'auth', error.status);
    }

    if (error.status === 429) {
      return buildFailure(context.provider, context.model, 'rate_limit', error.status);
    }

    if ([400, 404, 409, 413, 415, 422].includes(error.status)) {
      return buildFailure(context.provider, context.model, 'invalid_request', error.status);
    }

    return buildFailure(
      context.provider,
      context.model,
      'provider_unavailable',
      error.status,
    );
  }

  if (error instanceof CloudProviderNetworkError) {
    return buildFailure(context.provider, context.model, 'network');
  }

  if (error instanceof CloudProviderProtocolError) {
    return buildFailure(context.provider, context.model, 'provider_unavailable');
  }

  return buildFailure(context.provider, context.model, 'provider_unavailable');
}

function createAdapterRegistry(adapters: CloudProviderAdapter[]) {
  return new Map(adapters.map((adapter) => [adapter.provider, adapter]));
}

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

function readObjectValue(payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null || !(key in payload)) {
    return undefined;
  }

  return (payload as Record<string, unknown>)[key];
}

function readStringValue(payload: unknown, key: string) {
  const value = readObjectValue(payload, key);
  return typeof value === 'string' ? value : undefined;
}

function extractOpenAIErrorMessage(payload: unknown) {
  const errorPayload = readObjectValue(payload, 'error');
  const message = readStringValue(errorPayload, 'message');

  return message ?? 'OpenAI request failed.';
}

function extractOpenAIResponseText(payload: unknown) {
  const choices = readObjectValue(payload, 'choices');

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const message = readObjectValue(choices[0], 'message');
  const content = readObjectValue(message, 'content');

  if (typeof content === 'string') {
    const normalized = content.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        const type = readStringValue(entry, 'type');
        if (type !== 'text') {
          return '';
        }

        return readStringValue(entry, 'text') ?? '';
      })
      .join('')
      .trim();

    return text.length > 0 ? text : null;
  }

  return null;
}

function extractOpenAIUsage(payload: unknown): CloudInferenceUsage | undefined {
  const usage = readObjectValue(payload, 'usage');

  if (typeof usage !== 'object' || usage === null) {
    return undefined;
  }

  const inputTokens = readObjectValue(usage, 'prompt_tokens');
  const outputTokens = readObjectValue(usage, 'completion_tokens');
  const totalTokens = readObjectValue(usage, 'total_tokens');

  const normalized: CloudInferenceUsage = {
    ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
    ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
    ...(typeof totalTokens === 'number' ? { totalTokens } : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

async function readResponseBody(response: FetchResponseLike) {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

export function createOpenAICloudProviderAdapter(
  options: CreateOpenAICloudProviderAdapterOptions = {},
): CloudProviderAdapter {
  const endpoint = options.endpoint ?? 'https://api.openai.com/v1/chat/completions';
  const fetchFn = resolveFetch(options.fetch);

  return {
    provider: 'openai',

    supportsModel(model) {
      return model === 'gpt-4.1';
    },

    async infer(input) {
      try {
        const requestBody = {
          model: input.model,
          messages: [
            ...(input.systemInstructionEn?.trim().length
              ? [
                  {
                    role: 'system',
                    content: input.systemInstructionEn.trim(),
                  },
                ]
              : []),
            {
              role: 'user',
              content: input.optimizedEnglishPrompt,
            },
          ],
          ...(typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0
            ? { max_completion_tokens: Math.floor(input.maxOutputTokens) }
            : {}),
        };

        const response = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new CloudProviderHttpError(
            'openai',
            response.status,
            extractOpenAIErrorMessage(await readResponseBody(response)),
          );
        }

        const payload = await response.json();
        const responseEnglish = extractOpenAIResponseText(payload);

        if (!responseEnglish) {
          throw new CloudProviderProtocolError(
            'openai',
            'OpenAI returned no assistant text content.',
          );
        }

        return {
          responseEnglish,
          usage: extractOpenAIUsage(payload),
        };
      } catch (error) {
        if (
          error instanceof CloudProviderHttpError ||
          error instanceof CloudProviderProtocolError
        ) {
          throw error;
        }

        throw new CloudProviderNetworkError(
          'openai',
          'OpenAI request failed before a response was received.',
          {
            cause: error,
          },
        );
      }
    },
  };
}

export function createCloudInferenceGateway(
  options: CreateCloudInferenceGatewayOptions,
): CloudInferenceGateway {
  ensureMainProcess(options.processType);

  const nowMs = options.nowMs ?? nowInMilliseconds;
  const settingsService =
    options.settingsService ?? createInMemoryAppSettingsService(defaultAppSettings);
  const adapters = options.adapters ?? [createOpenAICloudProviderAdapter()];
  const registry = createAdapterRegistry(adapters);

  return {
    async infer(input) {
      const model = input.model ?? (await settingsService.getSettings()).defaultModel;
      const provider = providerByModel[model];
      const optimizedEnglishPrompt = input.optimizedEnglishPrompt.trim();

      if (!optimizedEnglishPrompt) {
        return buildFailure(provider, model, 'invalid_request');
      }

      const adapter = registry.get(provider);
      if (!adapter || !adapter.supportsModel(model)) {
        return buildFailure(provider, model, 'provider_unavailable');
      }

      const apiKey = (await options.secretService.getProviderApiKey(provider))?.trim() ?? '';

      if (!apiKey) {
        return buildFailure(provider, model, 'auth');
      }

      const startedAt = nowMs();

      try {
        const result = await adapter.infer({
          model,
          optimizedEnglishPrompt,
          apiKey,
          maxOutputTokens: input.maxOutputTokens,
          systemInstructionEn: input.systemInstructionEn,
        });

        return {
          ok: true,
          provider,
          model,
          responseEnglish: result.responseEnglish,
          usage: result.usage,
          latencyMs: Math.max(0, nowMs() - startedAt),
        };
      } catch (error) {
        return normalizeProviderFailure(error, {
          provider,
          model,
        });
      }
    },
  };
}
