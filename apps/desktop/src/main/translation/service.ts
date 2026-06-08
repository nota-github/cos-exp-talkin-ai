import { spawn } from 'node:child_process';
import type { OptimizationMode } from '../../shared/ipc/contracts';

export type TranslationPreservationInput = {
  namedEntities: string[];
  requiredConstraints: string[];
  outputFormat?: string;
  preserveStructure: Array<'tables' | 'lists' | 'headings' | 'checklists'>;
  preserveNumericLiterals: boolean;
};

export type TranslationMcpOptimizationMode =
  | 'default'
  | 'cost_saver'
  | 'quality'
  | 'long_context';

export type OptimizePromptInput = {
  sourceKorean: string;
  mode: OptimizationMode;
  conversationSummary?: string;
  preservation: TranslationPreservationInput;
};

export type OptimizePromptResult = {
  optimizedEnglish: string;
  preservationChecks: {
    entitiesPreserved: boolean;
    constraintsPreserved: boolean;
    outputFormatPreserved: boolean;
  };
  notes?: string[];
};

export type RestoreResponseInput = {
  sourceKorean: string;
  optimizedEnglish: string;
  cloudEnglishResponse: string;
  mode: OptimizationMode;
  preservation: TranslationPreservationInput;
};

export type RestoreResponseResult = {
  restoredKorean: string;
  notes?: string[];
};

export type TranslationMcpOptimizePromptParams = {
  sourceKorean: string;
  mode: TranslationMcpOptimizationMode;
  conversationSummary?: string;
  outputHints?: string[];
  namedEntities?: string[];
};

export type TranslationMcpRestoreResponseParams = {
  sourceKorean: string;
  optimizedEnglish: string;
  cloudEnglishResponse: string;
  outputHints?: string[];
};

export type SummarizeConversationContextInput = {
  turns: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    language: 'ko' | 'en';
  }>;
  mode: OptimizationMode;
  preservation: TranslationPreservationInput;
  maxSummaryCharacters?: number;
};

export type SummarizeConversationContextResult = {
  summary: string;
  omittedTurnCount?: number;
};

export type TranslationMcpHealthPayload = {
  ok: boolean;
  engineId?: string;
  version?: string;
  message?: string;
  warnings?: string[];
};

export type TranslationMcpFailureCode =
  | 'none'
  | 'sidecar_unreachable'
  | 'misconfigured'
  | 'runtime_error'
  | 'protocol_error';

export type TranslationEngineHealthState = {
  status: 'ready' | 'degraded' | 'unavailable';
  checkedAt: string;
  engineId: string;
  transport: TranslationMcpTransport;
  failureCode: TranslationMcpFailureCode;
  message: string;
  warnings: string[];
  meta: {
    latencyMs: number;
    version?: string;
  };
};

export type TranslationMcpMethodDefinitions = {
  healthCheck: {
    params: Record<string, never>;
    result: TranslationMcpHealthPayload;
  };
  optimizePrompt: {
    params: TranslationMcpOptimizePromptParams;
    result: OptimizePromptResult;
  };
  restoreResponse: {
    params: TranslationMcpRestoreResponseParams;
    result: RestoreResponseResult;
  };
  summarizeConversationContext: {
    params: SummarizeConversationContextInput;
    result: SummarizeConversationContextResult;
  };
};

export type TranslationMcpMethod = keyof TranslationMcpMethodDefinitions;
export type TranslationMcpTransport = 'stdio' | 'fake';

export interface TranslationMcpRuntime {
  transport: TranslationMcpTransport;
  invoke<TMethod extends TranslationMcpMethod>(
    method: TMethod,
    params: TranslationMcpMethodDefinitions[TMethod]['params'],
  ): Promise<TranslationMcpMethodDefinitions[TMethod]['result']>;
}

export interface TranslationMcpAdapter {
  readonly engineId: string;
  readonly transport: TranslationMcpTransport;
  healthCheck(): Promise<TranslationEngineHealthState>;
  optimizePrompt(input: OptimizePromptInput): Promise<OptimizePromptResult>;
  restoreResponse(input: RestoreResponseInput): Promise<RestoreResponseResult>;
  summarizeConversationContext(
    input: SummarizeConversationContextInput,
  ): Promise<SummarizeConversationContextResult>;
}

export type CreateTranslationMcpAdapterOptions = {
  runtime: TranslationMcpRuntime;
  engineId?: string;
  now?: () => string;
  processType?: string;
};

export type CreateFakeTranslationMcpRuntimeHandlers = Partial<{
  [TMethod in TranslationMcpMethod]: (
    params: TranslationMcpMethodDefinitions[TMethod]['params'],
  ) =>
    | TranslationMcpMethodDefinitions[TMethod]['result']
    | Promise<TranslationMcpMethodDefinitions[TMethod]['result']>;
}>;

export type StdioTranslationMcpRuntimeOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
};

export class TranslationMcpRuntimeError extends Error {
  readonly code: Exclude<TranslationMcpFailureCode, 'none'>;

  constructor(
    code: Exclude<TranslationMcpFailureCode, 'none'>,
    message: string,
    options?: {
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'TranslationMcpRuntimeError';
    this.code = code;

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
      'Talkin AI Translation MCP adapter can only be created in the Electron main process.',
    );
  }
}

function nowInMilliseconds() {
  return Date.now();
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

const optimizationModeMap: Record<OptimizationMode, TranslationMcpOptimizationMode> = {
  balanced: 'default',
  savings: 'cost_saver',
  quality: 'quality',
  long_context: 'long_context',
};

const structureHintLabels: Record<
  TranslationPreservationInput['preserveStructure'][number],
  string
> = {
  tables: 'Preserve table structure',
  lists: 'Preserve list structure',
  headings: 'Preserve heading hierarchy',
  checklists: 'Preserve checklist structure',
};

export function normalizeOptimizationModeForTranslationMcp(
  mode: OptimizationMode,
): TranslationMcpOptimizationMode {
  return optimizationModeMap[mode];
}

export function buildOutputHintsForTranslationMcp(
  preservation: TranslationPreservationInput,
) {
  const outputHints = [
    ...preservation.requiredConstraints,
    ...(preservation.outputFormat
      ? [`Target output format: ${preservation.outputFormat}`]
      : []),
    ...preservation.preserveStructure.map((entry) => structureHintLabels[entry]),
    ...(preservation.preserveNumericLiterals ? ['Preserve numeric literals exactly'] : []),
  ];

  return uniqueNonEmpty(outputHints);
}

export function normalizeOptimizePromptInputForTranslationMcp(
  input: OptimizePromptInput,
): TranslationMcpOptimizePromptParams {
  const outputHints = buildOutputHintsForTranslationMcp(input.preservation);
  const namedEntities = uniqueNonEmpty(input.preservation.namedEntities);

  return {
    sourceKorean: input.sourceKorean,
    mode: normalizeOptimizationModeForTranslationMcp(input.mode),
    conversationSummary:
      input.conversationSummary?.trim().length ? input.conversationSummary : undefined,
    outputHints: outputHints.length > 0 ? outputHints : undefined,
    namedEntities: namedEntities.length > 0 ? namedEntities : undefined,
  };
}

export function normalizeRestoreResponseInputForTranslationMcp(
  input: RestoreResponseInput,
): TranslationMcpRestoreResponseParams {
  const outputHints = buildOutputHintsForTranslationMcp(input.preservation);

  return {
    sourceKorean: input.sourceKorean,
    optimizedEnglish: input.optimizedEnglish,
    cloudEnglishResponse: input.cloudEnglishResponse,
    outputHints: outputHints.length > 0 ? outputHints : undefined,
  };
}

function normalizeHealthPayload(
  payload: TranslationMcpHealthPayload,
  checkedAt: string,
  latencyMs: number,
  transport: TranslationMcpTransport,
  engineId: string,
): TranslationEngineHealthState {
  const warnings = payload.warnings ?? [];
  const resolvedEngineId = payload.engineId ?? engineId;

  if (!payload.ok) {
    return {
      status: 'unavailable',
      checkedAt,
      engineId: resolvedEngineId,
      transport,
      failureCode: 'runtime_error',
      message: payload.message ?? '로컬 최적화 엔진을 사용할 수 없습니다.',
      warnings,
      meta: {
        latencyMs,
        version: payload.version,
      },
    };
  }

  return {
    status: warnings.length > 0 ? 'degraded' : 'ready',
    checkedAt,
    engineId: resolvedEngineId,
    transport,
    failureCode: 'none',
    message:
      payload.message ??
      (warnings.length > 0
        ? '로컬 최적화 엔진은 응답했지만 확인이 필요한 경고가 있습니다.'
        : '로컬 최적화 엔진이 준비되었습니다.'),
    warnings,
    meta: {
      latencyMs,
      version: payload.version,
    },
  };
}

function mapHealthFailure(
  error: unknown,
  checkedAt: string,
  latencyMs: number,
  transport: TranslationMcpTransport,
  engineId: string,
): TranslationEngineHealthState {
  const runtimeError =
    error instanceof TranslationMcpRuntimeError
      ? error
      : new TranslationMcpRuntimeError(
          'runtime_error',
          error instanceof Error
            ? error.message
            : '로컬 최적화 엔진 health check 중 알 수 없는 오류가 발생했습니다.',
          {
            cause: error,
          },
        );

  return {
    status: 'unavailable',
    checkedAt,
    engineId,
    transport,
    failureCode: runtimeError.code,
    message: runtimeError.message,
    warnings: [],
    meta: {
      latencyMs,
    },
  };
}

function mapSpawnFailure(command: string, error: unknown) {
  const spawnError = error as {
    code?: string;
    message?: string;
  };

  if (spawnError.code === 'ENOENT') {
    return new TranslationMcpRuntimeError(
      'sidecar_unreachable',
      `Translation MCP sidecar command could not be started: ${command}`,
      {
        cause: error,
      },
    );
  }

  return new TranslationMcpRuntimeError(
    'runtime_error',
    `Translation MCP stdio transport failed for ${command}.`,
    {
      cause: error,
    },
  );
}

async function invokeOverStdio<TMethod extends TranslationMcpMethod>(
  options: StdioTranslationMcpRuntimeOptions,
  method: TMethod,
  params: TranslationMcpMethodDefinitions[TMethod]['params'],
): Promise<TranslationMcpMethodDefinitions[TMethod]['result']> {
  const command = options.command.trim();

  if (!command) {
    throw new TranslationMcpRuntimeError(
      'misconfigured',
      'Translation MCP stdio command is not configured.',
    );
  }

  const spawnProcess = options.spawnProcess ?? spawn;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, options.args ?? [], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let settled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const settleResolve = (value: TranslationMcpMethodDefinitions[TMethod]['result']) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolve(value);
    };

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      reject(error);
    };

    child.on('error', (error) => {
      settleReject(mapSpawnFailure(command, error));
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderrBuffer += String(chunk);
    });
    child.stdin?.on('error', (error) => {
      settleReject(
        new TranslationMcpRuntimeError(
          'runtime_error',
          'Failed to write the Translation MCP stdio request.',
          {
            cause: error,
          },
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (code !== 0) {
        settleReject(
          new TranslationMcpRuntimeError(
            code === 127 ? 'sidecar_unreachable' : 'runtime_error',
            `Translation MCP sidecar exited before returning a response${
              code === null ? '' : ` (code ${code})`
            }${signal ? ` with signal ${signal}` : ''}${
              stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : '.'
            }`,
          ),
        );
        return;
      }

      if (!stdoutBuffer.trim()) {
        settleReject(
          new TranslationMcpRuntimeError(
            'protocol_error',
            'Translation MCP sidecar returned an empty response.',
          ),
        );
        return;
      }

      try {
        settleResolve(
          JSON.parse(stdoutBuffer) as TranslationMcpMethodDefinitions[TMethod]['result'],
        );
      } catch (error) {
        settleReject(
          new TranslationMcpRuntimeError(
            'protocol_error',
            'Translation MCP sidecar returned invalid JSON.',
            {
              cause: error,
            },
          ),
        );
      }
    });

    child.stdin?.end(
      JSON.stringify({
        method,
        params,
      }),
    );

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        child.kill();
        settleReject(
          new TranslationMcpRuntimeError(
            'runtime_error',
            `Translation MCP sidecar timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
    }
  });
}

export function createFakeTranslationMcpRuntime(
  handlers: CreateFakeTranslationMcpRuntimeHandlers,
): TranslationMcpRuntime {
  return {
    transport: 'fake',
    async invoke(method, params) {
      const handler = handlers[method];

      if (!handler) {
        throw new TranslationMcpRuntimeError(
          'misconfigured',
          `No fake Translation MCP handler is registered for ${method}.`,
        );
      }

      return handler(params as never) as Promise<
        TranslationMcpMethodDefinitions[typeof method]['result']
      >;
    },
  };
}

export function createStdioTranslationMcpRuntime(
  options: StdioTranslationMcpRuntimeOptions,
): TranslationMcpRuntime {
  return {
    transport: 'stdio',
    invoke(method, params) {
      return invokeOverStdio(options, method, params);
    },
  };
}

export function createTranslationMcpAdapter(
  options: CreateTranslationMcpAdapterOptions,
): TranslationMcpAdapter {
  ensureMainProcess(options.processType);

  const runtime = options.runtime;
  const now = options.now ?? (() => new Date().toISOString());
  const engineId = options.engineId ?? 'translation-mcp';

  return {
    engineId,
    transport: runtime.transport,
    async healthCheck() {
      const checkedAt = now();
      const startedAt = nowInMilliseconds();

      try {
        const payload = await runtime.invoke('healthCheck', {});
        const latencyMs = Math.max(nowInMilliseconds() - startedAt, 0);

        return normalizeHealthPayload(payload, checkedAt, latencyMs, runtime.transport, engineId);
      } catch (error) {
        const latencyMs = Math.max(nowInMilliseconds() - startedAt, 0);
        return mapHealthFailure(error, checkedAt, latencyMs, runtime.transport, engineId);
      }
    },
    optimizePrompt(input) {
      return runtime.invoke(
        'optimizePrompt',
        normalizeOptimizePromptInputForTranslationMcp(input),
      );
    },
    restoreResponse(input) {
      return runtime.invoke(
        'restoreResponse',
        normalizeRestoreResponseInputForTranslationMcp(input),
      );
    },
    summarizeConversationContext(input) {
      return runtime.invoke('summarizeConversationContext', input);
    },
  };
}
