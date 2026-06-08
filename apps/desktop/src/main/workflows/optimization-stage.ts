import { randomUUID } from 'node:crypto';
import type {
  ChatRunPersistence,
  ConversationRecord,
  MessageRecord,
  RunRecord,
} from '../persistence/index.ts';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
  openSqliteDatabase,
} from '../persistence/index.ts';
import type {
  OptimizePromptInput,
  OptimizePromptResult,
  TranslationMcpOptimizePromptParams,
  TranslationMcpAdapter,
  TranslationMcpRuntimeError,
  TranslationPreservationInput,
} from '../translation/index.ts';
import { normalizeOptimizePromptInputForTranslationMcp } from '../translation/index.ts';

type OrchestratorCreateId = (prefix: string) => string;

export type OptimizeQueuedRunCommand = {
  runId: string;
};

export type OptimizationDispatchInput = {
  runId: string;
  model: RunRecord['model'];
  mode: RunRecord['mode'];
  sourceKorean: string;
  optimizedEnglish: string;
  conversationSummary?: string;
};

export type OptimizationStageResult =
  | {
      status: 'optimized';
      runId: string;
      optimizedPromptEn: string;
      promptArtifactsStored: ['optimized_prompt_en', 'preservation_check'];
    }
  | {
      status: 'failed';
      runId: string;
      errorCode: string;
    }
  | {
      status: 'skipped';
      runId: string;
      reason: 'run_not_found' | 'run_not_queued';
    };

export interface OptimizationStageOrchestrator {
  optimizeQueuedRun(input: OptimizeQueuedRunCommand): Promise<OptimizationStageResult>;
}

export type CreatePersistentOptimizationStageOrchestratorOptions = {
  dbPath: string;
  translationAdapter: TranslationMcpAdapter;
  now?: () => string;
  createId?: OrchestratorCreateId;
  dispatchOptimizedRun?: (
    input: OptimizationDispatchInput,
  ) => Promise<void> | void;
};

type ClaimedQueuedRun = {
  run: RunRecord;
  message: MessageRecord;
  conversation: ConversationRecord;
  optimizeInput: OptimizePromptInput;
};

type SqlitePersistenceHandle = {
  persistence: ChatRunPersistence;
  close(): Promise<void>;
};

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function estimateTokenCount(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function extractNamedEntities(sourceKorean: string) {
  const latinEntityMatches =
    sourceKorean.match(/[A-Za-z][A-Za-z0-9.+-]*(?:\s+[A-Za-z][A-Za-z0-9.+-]*)*/g) ?? [];

  return uniqueValues(latinEntityMatches).slice(0, 12);
}

function extractRequiredConstraints(sourceKorean: string) {
  const lines = sourceKorean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const constraintHints = [
    '유지',
    '보존',
    '그대로',
    '반드시',
    '꼭',
    '빠뜨리지',
    '형식',
    '출력',
    '표',
    '체크리스트',
    '목차',
    '번호',
    '리스트',
  ];

  const matchedLines = lines.filter((line) =>
    constraintHints.some((hint) => line.includes(hint)),
  );

  return uniqueValues(matchedLines).slice(0, 12);
}

function detectOutputFormat(sourceKorean: string) {
  if (/마크다운|markdown/i.test(sourceKorean) && /체크리스트/.test(sourceKorean)) {
    return 'markdown checklist';
  }

  if (/체크리스트/.test(sourceKorean)) {
    return 'checklist';
  }

  if (/표/.test(sourceKorean)) {
    return 'table';
  }

  if (/목차|헤딩|제목/.test(sourceKorean)) {
    return 'heading outline';
  }

  if (/번호\s*목록|번호\s*리스트|번호\s*순서/.test(sourceKorean)) {
    return 'numbered list';
  }

  return undefined;
}

function detectPreserveStructure(
  sourceKorean: string,
): TranslationPreservationInput['preserveStructure'] {
  const preserveStructure: TranslationPreservationInput['preserveStructure'] = [];

  if (/표/.test(sourceKorean) || /\|.+\|/.test(sourceKorean)) {
    preserveStructure.push('tables');
  }

  if (/체크리스트/.test(sourceKorean) || /\[[ xX]\]/.test(sourceKorean)) {
    preserveStructure.push('checklists');
  }

  if (/목차|헤딩|제목/.test(sourceKorean)) {
    preserveStructure.push('headings');
  }

  if (
    /리스트|목록|항목|불릿|번호/.test(sourceKorean) ||
    /^\s*[-*]\s/m.test(sourceKorean) ||
    /^\s*\d+\.\s/m.test(sourceKorean)
  ) {
    preserveStructure.push('lists');
  }

  return uniqueValues(preserveStructure) as TranslationPreservationInput['preserveStructure'];
}

function buildPreservationInput(sourceKorean: string): TranslationPreservationInput {
  return {
    namedEntities: extractNamedEntities(sourceKorean),
    requiredConstraints: extractRequiredConstraints(sourceKorean),
    outputFormat: detectOutputFormat(sourceKorean),
    preserveStructure: detectPreserveStructure(sourceKorean),
    preserveNumericLiterals: /\d/.test(sourceKorean) || /숫자|수치|퍼센트|%/.test(sourceKorean),
  };
}

function buildRecoverableErrorCode(
  error:
    | TranslationMcpRuntimeError
    | {
        code?: string;
      }
    | unknown,
) {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'runtime_error';

  return `local_optimization_${code}`;
}

function buildFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return '로컬 최적화 단계에서 알 수 없는 오류가 발생했습니다.';
}

function serializePreservationArtifact(
  optimizeRequest: TranslationMcpOptimizePromptParams,
  optimizeResult: OptimizePromptResult,
) {
  return JSON.stringify({
    sourceKorean: optimizeRequest.sourceKorean,
    mode: optimizeRequest.mode,
    conversationSummary: optimizeRequest.conversationSummary ?? null,
    outputHints: optimizeRequest.outputHints ?? [],
    namedEntities: optimizeRequest.namedEntities ?? [],
    preservationChecks: optimizeResult.preservationChecks,
    notes: optimizeResult.notes ?? [],
  });
}

async function openPersistence(dbPath: string): Promise<SqlitePersistenceHandle> {
  const handle = await openSqliteDatabase(dbPath);
  await migrateDesktopSchema(handle.connection);

  const persistence = createChatRunPersistence(handle.connection);

  return {
    persistence,
    close() {
      return persistence.close();
    },
  };
}

export function createPersistentOptimizationStageOrchestrator(
  options: CreatePersistentOptimizationStageOrchestratorOptions,
): OptimizationStageOrchestrator {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? defaultCreateId;

  async function failRun(
    persistence: ChatRunPersistence,
    input: {
      runId: string;
      taskId?: string;
      errorCode: string;
      failureMessage: string;
      details: Record<string, unknown>;
    },
  ) {
    const failedAt = now();

    await persistence.transaction(async (tx) => {
      const updatedRun = await tx.runRecords.updateStatus({
        runId: input.runId,
        status: 'failed',
        endedAt: failedAt,
        errorCode: input.errorCode,
      });

      await tx.runStages.create({
        id: createId('stage'),
        runId: input.runId,
        stage: 'failed',
        status: 'failed',
        startedAt: failedAt,
        endedAt: failedAt,
        details: {
          recoverable: true,
          message: input.failureMessage,
          ...input.details,
        },
      });

      const taskId = input.taskId ?? updatedRun?.taskId;
      if (taskId) {
        await tx.tasks.updateActivity({
          taskId,
          updatedAt: failedAt,
          lastActivityAt: failedAt,
        });
      }
    });
  }

  async function claimQueuedRun(
    persistence: ChatRunPersistence,
    runId: string,
  ): Promise<ClaimedQueuedRun | OptimizationStageResult> {
    return persistence.transaction(async (tx) => {
      const run = await tx.runRecords.getById(runId);

      if (!run) {
        return {
          status: 'skipped',
          runId,
          reason: 'run_not_found',
        } as const;
      }

      if (run.status !== 'queued') {
        return {
          status: 'skipped',
          runId,
          reason: 'run_not_queued',
        } as const;
      }

      const message = await tx.messages.getById(run.messageId);
      const conversation = await tx.conversations.getById(run.conversationId);

      if (!message || message.contentKo.trim().length === 0 || !conversation) {
        const errorCode = 'local_optimization_missing_source_prompt';
        const failureAt = now();

        await tx.runRecords.updateStatus({
          runId,
          status: 'failed',
          endedAt: failureAt,
          errorCode,
        });
        await tx.runStages.create({
          id: createId('stage'),
          runId,
          stage: 'failed',
          status: 'failed',
          startedAt: failureAt,
          endedAt: failureAt,
          details: {
            recoverable: true,
            failureCode: 'missing_source_prompt',
            message:
              '저장된 한국어 원문이 없어 로컬 최적화를 시작할 수 없습니다.',
          },
        });
        await tx.tasks.updateActivity({
          taskId: run.taskId,
          updatedAt: failureAt,
          lastActivityAt: failureAt,
        });

        return {
          status: 'failed',
          runId,
          errorCode,
        } as const;
      }

      const claimedAt = now();

      await tx.runRecords.updateStatus({
        runId,
        status: 'optimizing',
        endedAt: null,
        errorCode: null,
      });
      await tx.runStages.create({
        id: createId('stage'),
        runId,
        stage: 'optimizing',
        status: 'running',
        startedAt: claimedAt,
        endedAt: null,
        details: {
          mode: run.mode,
          conversationSummary: conversation.summary,
          sourceLength: message.contentKo.length,
        },
      });

      return {
        run,
        message,
        conversation,
        optimizeInput: {
          sourceKorean: message.contentKo,
          mode: run.mode,
          conversationSummary: conversation.summary ?? undefined,
          preservation: buildPreservationInput(message.contentKo),
        },
      } satisfies ClaimedQueuedRun;
    });
  }

  return {
    async optimizeQueuedRun(input) {
      const handle = await openPersistence(options.dbPath);
      const persistence = handle.persistence;

      try {
        const claimedRun = await claimQueuedRun(persistence, input.runId);

        if ('status' in claimedRun) {
          return claimedRun;
        }

        let optimizeResult: OptimizePromptResult;
        try {
          optimizeResult = await options.translationAdapter.optimizePrompt(
            claimedRun.optimizeInput,
          );
        } catch (error) {
          const errorCode = buildRecoverableErrorCode(error);

          await failRun(persistence, {
            runId: input.runId,
            taskId: claimedRun.run.taskId,
            errorCode,
            failureMessage: buildFailureMessage(error),
            details: {
              stage: 'optimizing',
              failureCode: errorCode.replace(/^local_optimization_/, ''),
            },
          });

          return {
            status: 'failed',
            runId: input.runId,
            errorCode,
          };
        }

        const optimizedAt = now();
        const optimizedPromptEn = optimizeResult.optimizedEnglish;
        const optimizeRequest = normalizeOptimizePromptInputForTranslationMcp(
          claimedRun.optimizeInput,
        );

        await persistence.transaction(async (tx) => {
          await tx.promptArtifacts.create({
            id: createId('artifact'),
            runId: input.runId,
            artifactType: 'optimized_prompt_en',
            content: optimizedPromptEn,
            tokenEstimate: estimateTokenCount(optimizedPromptEn),
            visibility: 'advanced',
          });
          await tx.promptArtifacts.create({
            id: createId('artifact'),
            runId: input.runId,
            artifactType: 'preservation_check',
            content: serializePreservationArtifact(optimizeRequest, optimizeResult),
            tokenEstimate: null,
            visibility: 'advanced',
          });
          await tx.runRecords.updateStatus({
            runId: input.runId,
            status: 'optimized',
            endedAt: null,
            errorCode: null,
          });
          await tx.runStages.create({
            id: createId('stage'),
            runId: input.runId,
            stage: 'optimized',
            status: 'completed',
            startedAt: optimizedAt,
            endedAt: optimizedAt,
            details: {
              conversationSummary: claimedRun.optimizeInput.conversationSummary ?? null,
              artifactTypes: ['optimized_prompt_en', 'preservation_check'],
              preservationChecks: optimizeResult.preservationChecks,
            },
          });
          await tx.tasks.updateActivity({
            taskId: claimedRun.run.taskId,
            updatedAt: optimizedAt,
            lastActivityAt: optimizedAt,
          });
        });

        if (options.dispatchOptimizedRun) {
          await options.dispatchOptimizedRun({
            runId: input.runId,
            model: claimedRun.run.model,
            mode: claimedRun.run.mode,
            sourceKorean: claimedRun.message.contentKo,
            optimizedEnglish: optimizedPromptEn,
            conversationSummary: claimedRun.optimizeInput.conversationSummary,
          });
        }

        return {
          status: 'optimized',
          runId: input.runId,
          optimizedPromptEn,
          promptArtifactsStored: ['optimized_prompt_en', 'preservation_check'],
        };
      } finally {
        await handle.close();
      }
    },
  };
}
