import { randomUUID } from 'node:crypto';
import type { AppSettings } from '../../shared/ipc/contracts';
import type { CloudInferenceGateway } from '../providers/index.ts';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
  openSqliteDatabase,
  type ChatRunPersistence,
  type ConversationRecord,
  type MessageRecord,
  type RunRecord,
} from '../persistence/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
  type AppSettingsService,
} from '../settings/index.ts';
import type { TranslationMcpAdapter, TranslationMcpRuntimeError } from '../translation/index.ts';
import { buildTaskProjectionInvalidationTargets } from '../ipc/invalidation.ts';
import { buildPreservationInput, buildUsageRecordInput, estimateTokenCount } from './run-helpers.ts';

type OrchestratorCreateId = (prefix: string) => string;

export type CompleteOptimizedRunCommand = {
  runId: string;
  model: RunRecord['model'];
  mode: RunRecord['mode'];
  optimizedEnglish: string;
};

export type CompletionStageResult =
  | {
      status: 'completed';
      runId: string;
      finalResponse: string;
      responseLanguage: AppSettings['responseLanguage'];
    }
  | {
      status: 'failed';
      runId: string;
      errorCode: string;
    }
  | {
      status: 'skipped';
      runId: string;
      reason: 'run_not_found' | 'run_not_optimized';
    };

export interface ResponseCompletionOrchestrator {
  completeOptimizedRun(
    input: CompleteOptimizedRunCommand,
  ): Promise<CompletionStageResult>;
}

export type CreatePersistentResponseCompletionOrchestratorOptions = {
  dbPath: string;
  cloudInferenceGateway: CloudInferenceGateway;
  translationAdapter: TranslationMcpAdapter;
  settingsService?: AppSettingsService;
  now?: () => string;
  createId?: OrchestratorCreateId;
  emitInvalidation?: (targets: ReturnType<typeof buildTaskProjectionInvalidationTargets>) => void;
};

type CompletedRunContext = {
  run: RunRecord;
  message: MessageRecord;
  conversation: ConversationRecord;
  optimizedEnglish: string;
  responseLanguage: AppSettings['responseLanguage'];
};

type SqlitePersistenceHandle = {
  persistence: ChatRunPersistence;
  close(): Promise<void>;
};

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildCloudFailureCode(code: string) {
  return `cloud_inference_${code}`;
}

function buildRestoreFailureCode(
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

  return `local_restore_${code}`;
}

function buildFailureMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
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

export function createPersistentResponseCompletionOrchestrator(
  options: CreatePersistentResponseCompletionOrchestratorOptions,
): ResponseCompletionOrchestrator {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? defaultCreateId;
  const settingsService =
    options.settingsService ?? createInMemoryAppSettingsService(defaultAppSettings);

  async function failRun(
    persistence: ChatRunPersistence,
    input: {
      runId: string;
      taskId?: string;
      errorCode: string;
      failureMessage: string;
      details: Record<string, unknown>;
      providerResponseEnglish?: string;
    },
  ) {
    const failedAt = now();

    const invalidationContext = await persistence.transaction(async (tx) => {
      if (input.providerResponseEnglish?.trim()) {
        await tx.promptArtifacts.create({
          id: createId('artifact'),
          runId: input.runId,
          artifactType: 'provider_response_en',
          content: input.providerResponseEnglish,
          tokenEstimate: estimateTokenCount(input.providerResponseEnglish),
          visibility: 'advanced',
        });
      }

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

      return {
        taskId: taskId ?? null,
        conversationId: updatedRun?.conversationId ?? null,
      };
    });

    options.emitInvalidation?.(
      buildTaskProjectionInvalidationTargets({
        taskId: invalidationContext.taskId,
        conversationId: invalidationContext.conversationId,
        runId: input.runId,
      }),
    );
  }

  async function claimOptimizedRun(
    persistence: ChatRunPersistence,
    input: CompleteOptimizedRunCommand,
    responseLanguage: AppSettings['responseLanguage'],
  ): Promise<CompletedRunContext | CompletionStageResult> {
    const claimedRun = await persistence.transaction(async (tx) => {
      const run = await tx.runRecords.getById(input.runId);

      if (!run) {
        return {
          status: 'skipped',
          runId: input.runId,
          reason: 'run_not_found',
        } as const;
      }

      if (run.status !== 'optimized') {
        return {
          status: 'skipped',
          runId: input.runId,
          reason: 'run_not_optimized',
        } as const;
      }

      const message = await tx.messages.getById(run.messageId);
      const conversation = await tx.conversations.getById(run.conversationId);

      if (!message || message.contentKo.trim().length === 0 || !conversation) {
        const failureAt = now();
        const errorCode = 'run_completion_missing_source_prompt';

        await tx.runRecords.updateStatus({
          runId: input.runId,
          status: 'failed',
          endedAt: failureAt,
          errorCode,
        });
        await tx.runStages.create({
          id: createId('stage'),
          runId: input.runId,
          stage: 'failed',
          status: 'failed',
          startedAt: failureAt,
          endedAt: failureAt,
          details: {
            recoverable: true,
            failureCode: 'missing_source_prompt',
            message:
              '저장된 한국어 원문이 없어 완료 단계를 진행할 수 없습니다.',
          },
        });
        await tx.tasks.updateActivity({
          taskId: run.taskId,
          updatedAt: failureAt,
          lastActivityAt: failureAt,
        });

        return {
          status: 'failed',
          runId: input.runId,
          errorCode,
        } as const;
      }

      const claimedAt = now();

      await tx.runRecords.updateStatus({
        runId: input.runId,
        status: 'cloud_pending',
        endedAt: null,
        errorCode: null,
      });
      await tx.runStages.create({
        id: createId('stage'),
        runId: input.runId,
        stage: 'cloud_pending',
        status: 'running',
        startedAt: claimedAt,
        endedAt: null,
        details: {
          model: run.model,
          provider: run.provider,
          responseLanguage,
          optimizedPromptLength: input.optimizedEnglish.length,
        },
      });

      return {
        run,
        message,
        conversation,
        optimizedEnglish: input.optimizedEnglish,
        responseLanguage,
      } satisfies CompletedRunContext;
    });

    if ('status' in claimedRun) {
      if (claimedRun.status === 'failed') {
        const run = await persistence.runRecords.getById(input.runId);

        options.emitInvalidation?.(
          buildTaskProjectionInvalidationTargets({
            taskId: run?.taskId ?? null,
            conversationId: run?.conversationId ?? null,
            runId: input.runId,
          }),
        );
      }

      return claimedRun;
    }

    options.emitInvalidation?.(
      buildTaskProjectionInvalidationTargets({
        taskId: claimedRun.run.taskId,
        conversationId: claimedRun.run.conversationId,
        runId: input.runId,
      }),
    );

    return claimedRun;
  }

  async function markRestoring(
    persistence: ChatRunPersistence,
    input: {
      runId: string;
      provider: RunRecord['provider'];
      model: RunRecord['model'];
      taskId: string;
    },
  ) {
    const startedAt = now();

    await persistence.transaction(async (tx) => {
      await tx.runRecords.updateStatus({
        runId: input.runId,
        status: 'restoring',
        endedAt: null,
        errorCode: null,
      });
      await tx.runStages.create({
        id: createId('stage'),
        runId: input.runId,
        stage: 'restoring',
        status: 'running',
        startedAt,
        endedAt: null,
        details: {
          provider: input.provider,
          model: input.model,
          responseLanguage: 'ko',
        },
      });
      await tx.tasks.updateActivity({
        taskId: input.taskId,
        updatedAt: startedAt,
        lastActivityAt: startedAt,
      });
    });

    const run = await persistence.runRecords.getById(input.runId);

    options.emitInvalidation?.(
      buildTaskProjectionInvalidationTargets({
        taskId: input.taskId,
        conversationId: run?.conversationId ?? null,
        runId: input.runId,
      }),
    );
  }

  async function completeRun(
    persistence: ChatRunPersistence,
    input: {
      context: CompletedRunContext;
      responseEnglish: string;
      finalResponse: string;
      restoredKorean?: string;
      latencyMs: number;
      reportedUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    },
  ) {
    const completedAt = now();
    const usageRecord = buildUsageRecordInput({
      id: createId('usage'),
      runId: input.context.run.id,
      model: input.context.run.model,
      provider: input.context.run.provider,
      sourceKorean: input.context.message.contentKo,
      optimizedEnglish: input.context.optimizedEnglish,
      responseEnglish: input.responseEnglish,
      latencyMs: input.latencyMs,
      reportedUsage: input.reportedUsage,
    });
    const artifactTypes: string[] = ['provider_response_en'];

    if (input.restoredKorean !== undefined) {
      artifactTypes.push('restored_response_ko');
    }

    await persistence.transaction(async (tx) => {
      await tx.promptArtifacts.create({
        id: createId('artifact'),
        runId: input.context.run.id,
        artifactType: 'provider_response_en',
        content: input.responseEnglish,
        tokenEstimate: estimateTokenCount(input.responseEnglish),
        visibility: 'advanced',
      });

      if (input.restoredKorean !== undefined) {
        await tx.promptArtifacts.create({
          id: createId('artifact'),
          runId: input.context.run.id,
          artifactType: 'restored_response_ko',
          content: input.restoredKorean,
          tokenEstimate: estimateTokenCount(input.restoredKorean),
          visibility: 'default',
        });
      }

      await tx.messages.create({
        id: createId('message'),
        conversationId: input.context.conversation.id,
        role: 'assistant',
        contentKo: input.finalResponse,
        runId: input.context.run.id,
        createdAt: completedAt,
      });

      await tx.runRecords.updateStatus({
        runId: input.context.run.id,
        status: 'completed',
        endedAt: completedAt,
        errorCode: null,
      });
      await tx.runStages.create({
        id: createId('stage'),
        runId: input.context.run.id,
        stage: 'completed',
        status: 'completed',
        startedAt: completedAt,
        endedAt: completedAt,
        details: {
          provider: input.context.run.provider,
          model: input.context.run.model,
          responseLanguage: input.context.responseLanguage,
          artifactTypes,
          latencyMs: usageRecord.latencyMs,
        },
      });
      await tx.tasks.updateActivity({
        taskId: input.context.run.taskId,
        updatedAt: completedAt,
        lastActivityAt: completedAt,
      });
      await tx.usageRecords.create(usageRecord);
    });

    options.emitInvalidation?.(
      buildTaskProjectionInvalidationTargets({
        taskId: input.context.run.taskId,
        conversationId: input.context.run.conversationId,
        runId: input.context.run.id,
        includeUsageDashboard: true,
      }),
    );
  }

  return {
    async completeOptimizedRun(input) {
      const responseLanguage = (await settingsService.getSettings()).responseLanguage;
      const handle = await openPersistence(options.dbPath);
      const persistence = handle.persistence;

      try {
        const claimedRun = await claimOptimizedRun(persistence, input, responseLanguage);

        if ('status' in claimedRun) {
          return claimedRun;
        }

        const cloudResult = await options.cloudInferenceGateway.infer({
          model: input.model,
          optimizedEnglishPrompt: claimedRun.optimizedEnglish,
        });

        if (!cloudResult.ok) {
          const errorCode = buildCloudFailureCode(cloudResult.code);

          await failRun(persistence, {
            runId: input.runId,
            taskId: claimedRun.run.taskId,
            errorCode,
            failureMessage: cloudResult.message,
            details: {
              stage: 'cloud_pending',
              failureCode: cloudResult.code,
              provider: cloudResult.provider,
              guidance: cloudResult.guidance,
              retryable: cloudResult.retryable,
              status: cloudResult.status ?? null,
            },
          });

          return {
            status: 'failed',
            runId: input.runId,
            errorCode,
          };
        }

        if (responseLanguage === 'en') {
          await completeRun(persistence, {
            context: claimedRun,
            responseEnglish: cloudResult.responseEnglish,
            finalResponse: cloudResult.responseEnglish,
            latencyMs: cloudResult.latencyMs,
            reportedUsage: cloudResult.usage,
          });

          return {
            status: 'completed',
            runId: input.runId,
            finalResponse: cloudResult.responseEnglish,
            responseLanguage,
          };
        }

        await markRestoring(persistence, {
          runId: input.runId,
          provider: claimedRun.run.provider,
          model: claimedRun.run.model,
          taskId: claimedRun.run.taskId,
        });

        try {
          const restoreResult = await options.translationAdapter.restoreResponse({
            sourceKorean: claimedRun.message.contentKo,
            optimizedEnglish: claimedRun.optimizedEnglish,
            cloudEnglishResponse: cloudResult.responseEnglish,
            mode: input.mode,
            preservation: buildPreservationInput(claimedRun.message.contentKo),
          });

          await completeRun(persistence, {
            context: claimedRun,
            responseEnglish: cloudResult.responseEnglish,
            finalResponse: restoreResult.restoredKorean,
            restoredKorean: restoreResult.restoredKorean,
            latencyMs: cloudResult.latencyMs,
            reportedUsage: cloudResult.usage,
          });

          return {
            status: 'completed',
            runId: input.runId,
            finalResponse: restoreResult.restoredKorean,
            responseLanguage,
          };
        } catch (error) {
          const errorCode = buildRestoreFailureCode(error);

          await failRun(persistence, {
            runId: input.runId,
            taskId: claimedRun.run.taskId,
            errorCode,
            failureMessage: buildFailureMessage(
              error,
              '한국어 응답 복원 단계에서 알 수 없는 오류가 발생했습니다.',
            ),
            details: {
              stage: 'restoring',
              failureCode: errorCode.replace(/^local_restore_/, ''),
            },
            providerResponseEnglish: cloudResult.responseEnglish,
          });

          return {
            status: 'failed',
            runId: input.runId,
            errorCode,
          };
        }
      } finally {
        await handle.close();
      }
    },
  };
}
