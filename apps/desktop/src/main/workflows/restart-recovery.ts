import { randomUUID } from 'node:crypto';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
  openSqliteDatabase,
  type ChatRunPersistence,
  type ChatRunPersistenceScope,
  type RunRecord,
} from '../persistence/index.ts';
import type { OptimizationStageOrchestrator } from './optimization-stage.ts';
import type { ResponseCompletionOrchestrator } from './response-completion.ts';

type OrchestratorCreateId = (prefix: string) => string;

type ResumableOptimizedRun = {
  runId: string;
  model: RunRecord['model'];
  mode: RunRecord['mode'];
  optimizedEnglish: string;
};

export type RestartRecoveryResult = {
  resumedQueuedRunIds: string[];
  resumedOptimizedRunIds: string[];
  interruptedAfterDispatchRunIds: string[];
};

export interface RestartRecoveryService {
  recoverInterruptedRuns(): Promise<RestartRecoveryResult>;
}

export type CreatePersistentRestartRecoveryServiceOptions = {
  dbPath: string;
  optimizationStageOrchestrator: OptimizationStageOrchestrator;
  responseCompletionOrchestrator: ResponseCompletionOrchestrator;
  now?: () => string;
  createId?: OrchestratorCreateId;
};

type SqlitePersistenceHandle = {
  persistence: ChatRunPersistence;
  close(): Promise<void>;
};

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
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

async function markInterruptedAfterDispatch(
  tx: ChatRunPersistenceScope,
  options: {
    runId: string;
    taskId: string;
    failedStage: 'cloud_pending' | 'restoring';
    now: string;
    createId: OrchestratorCreateId;
  },
) {
  await tx.runRecords.updateStatus({
    runId: options.runId,
    status: 'failed',
    endedAt: options.now,
    errorCode: 'interrupted_after_dispatch',
  });
  await tx.runStages.create({
    id: options.createId('stage'),
    runId: options.runId,
    stage: 'failed',
    status: 'failed',
    startedAt: options.now,
    endedAt: options.now,
    details: {
      stage: options.failedStage,
      source: 'restart-recovery',
      recoveryPolicy: 'explicit_retry',
      interruptedAfterDispatch: true,
      recoverable: true,
      retryable: true,
      message:
        '앱이 클라우드 응답 처리 중 닫혀 자동 재개하지 않았습니다.',
      guidance:
        '같은 한국어 원문은 유지됩니다. 중복 청구 가능성을 피하려면 내용을 확인한 뒤 명시적으로 다시 시도하세요.',
    },
  });
  await tx.tasks.updateActivity({
    taskId: options.taskId,
    updatedAt: options.now,
    lastActivityAt: options.now,
  });
}

export function createPersistentRestartRecoveryService(
  options: CreatePersistentRestartRecoveryServiceOptions,
): RestartRecoveryService {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? defaultCreateId;

  return {
    async recoverInterruptedRuns() {
      const handle = await openPersistence(options.dbPath);
      const persistence = handle.persistence;

      try {
        const recoveryPlan = await persistence.transaction(async (tx) => {
          const queuedRunIds: string[] = [];
          const optimizedRuns: ResumableOptimizedRun[] = [];
          const interruptedRunIds: string[] = [];
          const candidateRuns = await tx.runRecords.listByStatuses([
            'queued',
            'optimizing',
            'optimized',
            'cloud_pending',
            'restoring',
          ]);

          for (const run of candidateRuns) {
            if (run.status === 'queued') {
              queuedRunIds.push(run.id);
              continue;
            }

            if (run.status === 'optimizing') {
              const recoveredAt = now();

              await tx.runRecords.updateStatus({
                runId: run.id,
                status: 'queued',
                endedAt: null,
                errorCode: null,
              });
              await tx.runStages.create({
                id: createId('stage'),
                runId: run.id,
                stage: 'queued',
                status: 'pending',
                startedAt: recoveredAt,
                endedAt: null,
                details: {
                  source: 'restart-recovery',
                  recoveredFromStage: 'optimizing',
                  recoveryPolicy: 'auto_resume',
                  storedBeforeExecution: true,
                  message:
                    '앱을 다시 열어 로컬 최적화를 안전하게 다시 이어갑니다.',
                },
              });
              await tx.tasks.updateActivity({
                taskId: run.taskId,
                updatedAt: recoveredAt,
                lastActivityAt: recoveredAt,
              });
              queuedRunIds.push(run.id);
              continue;
            }

            if (run.status === 'optimized') {
              const artifacts = await tx.promptArtifacts.listByRunId(run.id);
              const optimizedPrompt = artifacts.find(
                (artifact) => artifact.artifactType === 'optimized_prompt_en',
              );

              if (!optimizedPrompt || optimizedPrompt.content.trim().length === 0) {
                const failedAt = now();

                await tx.runRecords.updateStatus({
                  runId: run.id,
                  status: 'failed',
                  endedAt: failedAt,
                  errorCode: 'restart_recovery_missing_optimized_prompt',
                });
                await tx.runStages.create({
                  id: createId('stage'),
                  runId: run.id,
                  stage: 'failed',
                  status: 'failed',
                  startedAt: failedAt,
                  endedAt: failedAt,
                  details: {
                    stage: 'optimized',
                    source: 'restart-recovery',
                    recoveryPolicy: 'explicit_retry',
                    recoverable: true,
                    retryable: true,
                    message:
                      '저장된 영어 최적화 프롬프트를 찾지 못해 자동 복구를 이어가지 못했습니다.',
                    guidance:
                      '같은 한국어 원문은 유지됩니다. 확인 후 다시 시도해 주세요.',
                  },
                });
                await tx.tasks.updateActivity({
                  taskId: run.taskId,
                  updatedAt: failedAt,
                  lastActivityAt: failedAt,
                });
                continue;
              }

              optimizedRuns.push({
                runId: run.id,
                model: run.model,
                mode: run.mode,
                optimizedEnglish: optimizedPrompt.content,
              });
              continue;
            }

            if (run.status === 'cloud_pending' || run.status === 'restoring') {
              interruptedRunIds.push(run.id);

              await markInterruptedAfterDispatch(tx, {
                runId: run.id,
                taskId: run.taskId,
                failedStage: run.status,
                now: now(),
                createId,
              });
            }
          }

          return {
            queuedRunIds,
            optimizedRuns,
            interruptedRunIds,
          };
        });

        for (const runId of recoveryPlan.queuedRunIds) {
          await options.optimizationStageOrchestrator.optimizeQueuedRun({
            runId,
          });
        }

        for (const run of recoveryPlan.optimizedRuns) {
          await options.responseCompletionOrchestrator.completeOptimizedRun({
            runId: run.runId,
            model: run.model,
            mode: run.mode,
            optimizedEnglish: run.optimizedEnglish,
          });
        }

        return {
          resumedQueuedRunIds: recoveryPlan.queuedRunIds,
          resumedOptimizedRunIds: recoveryPlan.optimizedRuns.map((run) => run.runId),
          interruptedAfterDispatchRunIds: recoveryPlan.interruptedRunIds,
        };
      } finally {
        await handle.close();
      }
    },
  };
}
