import { useEffect, useReducer, useState } from 'react';
import type { ChatFeedRunSummary, PanelSlot } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import {
  getSafeDesktopActionErrorMessage,
  getSafeDesktopErrorCopy,
} from '../lib/ipc/error-copy';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import { getChatResponseMetadata, getChatRunFeedback } from './chat-surface';
import {
  closeWorkbenchPanelInPreview,
  createWorkbenchComposerState,
  getLatestWorkbenchPanelRun,
  getWorkbenchPanelActivityItems,
  getWorkbenchStatusLabel,
  hasInFlightWorkbenchRun,
  mergeWorkbenchPanelMessages,
  moveWorkbenchPanelInPreview,
  placeWorkbenchTaskInPreview,
  previewWorkbenchLayout,
  workbenchComposerReducer,
  workbenchSlotLabels,
  workbenchSurfaceCopy,
  getWorkbenchSurfaceState,
} from './workbench-surface';

const slotShortLabels: Record<PanelSlot, string> = {
  'north-west': 'A',
  'north-east': 'B',
  'south-west': 'C',
  'south-east': 'D',
};

function getPanelRunBadgeLabel(run: ChatFeedRunSummary | null) {
  if (!run) {
    return null;
  }

  switch (run.status) {
    case 'queued':
      return '실행 대기';
    case 'optimizing':
      return '로컬 최적화';
    case 'optimized':
      return '영문 프롬프트 준비';
    case 'cloud_pending':
      return '모델 응답 대기';
    case 'restoring':
      return '한국어 복원';
    case 'completed':
      return '응답 저장 완료';
    case 'failed':
      return '실행 실패';
  }
}

function QueryDiagnostic({ diagnostic }: { diagnostic: string | null }) {
  if (!diagnostic) {
    return null;
  }

  return (
    <details className="state-diagnostic">
      <summary>세부 정보 보기</summary>
      <p>{diagnostic}</p>
    </details>
  );
}

export function WorkbenchRoute() {
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const workbenchLayoutDescriptor = createDesktopQueryDescriptor('getWorkbenchLayout', {});
  const workbenchLayoutQuery = useDesktopQuery(
    queryCache,
    workbenchLayoutDescriptor,
    { enabled: desktopClient.available },
  );
  const [previewLayout, setPreviewLayout] = useState(previewWorkbenchLayout);
  const [activePanelSlot, setActivePanelSlot] = useState<PanelSlot | null>(
    desktopClient.available ? null : previewWorkbenchLayout.activePanelSlot,
  );
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [pendingPanelAction, setPendingPanelAction] = useState<string | null>(null);
  const [composerState, dispatchComposerAction] = useReducer(
    workbenchComposerReducer,
    undefined,
    createWorkbenchComposerState,
  );
  const surfaceState = getWorkbenchSurfaceState({
    desktopAvailable: desktopClient.available,
    queryStatus: workbenchLayoutQuery.status,
    layout: workbenchLayoutQuery.data,
    previewLayout,
    activePanelSlot,
  });
  const workbenchErrorCopy = getSafeDesktopErrorCopy(
    workbenchLayoutQuery.error,
    workbenchSurfaceCopy.railErrorBody,
  );
  const workbenchSyncWarningCopy = getSafeDesktopErrorCopy(
    workbenchLayoutQuery.error,
    workbenchSurfaceCopy.railSyncWarningBody,
  );
  const shouldPollActiveRun = surfaceState.panels.some((panel) =>
    hasInFlightWorkbenchRun(getLatestWorkbenchPanelRun(panel)),
  );

  useEffect(() => {
    if (!surfaceState.layout) {
      return;
    }

    setActivePanelSlot(surfaceState.layout.activePanelSlot);
  }, [surfaceState.layout?.activePanelSlot, surfaceState.layout?.updatedAt]);

  useEffect(() => {
    if (!desktopClient.available || !shouldPollActiveRun) {
      return;
    }

    const intervalId = setInterval(() => {
      void queryCache.fetchQuery(workbenchLayoutDescriptor).catch(() => undefined);
    }, 900);

    return () => {
      clearInterval(intervalId);
    };
  }, [desktopClient.available, queryCache, shouldPollActiveRun, workbenchLayoutDescriptor.key]);

  useEffect(() => {
    const slotsToCommit = surfaceState.panels.flatMap((panel) => {
      const pendingSubmission = composerState[panel.slot].pendingSubmission;

      if (
        pendingSubmission &&
        panel.conversation?.messages.some(
          (message) => message.messageId === pendingSubmission.messageId,
        )
      ) {
        return [panel.slot];
      }

      return [];
    });

    if (slotsToCommit.length === 0) {
      return;
    }

    for (const slot of slotsToCommit) {
      dispatchComposerAction({
        type: 'pending_submission_committed',
        slot,
      });
    }
  }, [composerState, surfaceState.panels]);

  async function refreshWorkbenchLayout() {
    await queryCache.fetchQuery(workbenchLayoutDescriptor);
  }

  async function handleRecentTaskSelect(taskId: string) {
    setPlacementError(null);

    if (!desktopClient.available) {
      const nextLayout = placeWorkbenchTaskInPreview(previewLayout, taskId);
      setPreviewLayout(nextLayout);
      setActivePanelSlot(nextLayout.activePanelSlot);
      return;
    }

    try {
      const result = await desktopClient.commands.openInWorkbench({ taskId });
      setActivePanelSlot(result.panelSlot);
    } catch (error) {
      setPlacementError(getSafeDesktopActionErrorMessage(error, workbenchSurfaceCopy.railErrorBody));
    }
  }

  async function handlePanelMove(fromPanelSlot: PanelSlot, toPanelSlot: PanelSlot) {
    setPlacementError(null);
    setPendingPanelAction(`move:${fromPanelSlot}:${toPanelSlot}`);

    try {
      if (!desktopClient.available) {
        const nextLayout = moveWorkbenchPanelInPreview(
          previewLayout,
          fromPanelSlot,
          toPanelSlot,
        );
        setPreviewLayout(nextLayout);
        setActivePanelSlot(nextLayout.activePanelSlot);
        return;
      }

      const result = await desktopClient.commands.moveWorkbenchPanel({
        fromPanelSlot,
        toPanelSlot,
      });
      setActivePanelSlot(result.panelSlot);
    } catch (error) {
      setPlacementError(getSafeDesktopActionErrorMessage(error, workbenchSurfaceCopy.railErrorBody));
    } finally {
      setPendingPanelAction(null);
    }
  }

  async function handlePanelClose(panelSlot: PanelSlot) {
    setPlacementError(null);
    setPendingPanelAction(`close:${panelSlot}`);

    try {
      if (!desktopClient.available) {
        const nextLayout = closeWorkbenchPanelInPreview(previewLayout, panelSlot);
        setPreviewLayout(nextLayout);
        setActivePanelSlot(nextLayout.activePanelSlot);
        return;
      }

      const result = await desktopClient.commands.closeWorkbenchPanel({
        panelSlot,
      });
      setActivePanelSlot(result.activePanelSlot);
    } catch (error) {
      setPlacementError(getSafeDesktopActionErrorMessage(error, workbenchSurfaceCopy.railErrorBody));
    } finally {
      setPendingPanelAction(null);
    }
  }

  async function handlePanelSubmit(panelSlot: PanelSlot) {
    const panel = surfaceState.panels.find((candidate) => candidate.slot === panelSlot);
    const currentComposerState = composerState[panelSlot];
    const promptKo = currentComposerState.draft.trim();

    if (!desktopClient.available || !panel?.conversation || promptKo.length === 0) {
      return;
    }

    const latestRun = getLatestWorkbenchPanelRun(panel);

    dispatchComposerAction({
      type: 'submit_started',
      slot: panelSlot,
    });
    setPlacementError(null);
    setActivePanelSlot(panelSlot);

    try {
      const result = await desktopClient.commands.submitPrompt({
        promptKo,
        selectedModel: latestRun?.model ?? 'gpt-4.1',
        optimizationMode: latestRun?.mode ?? 'balanced',
        conversationId: panel.conversation.conversationId,
      });
      dispatchComposerAction({
        type: 'submit_succeeded',
        slot: panelSlot,
        pendingSubmission: {
          messageId: result.messageId,
          conversationId: result.conversationId,
          runId: result.runId,
          role: 'user',
          contentKo: promptKo,
          createdAt: new Date().toISOString(),
        },
      });
      await queryCache.fetchQuery(workbenchLayoutDescriptor);
    } catch (error) {
      dispatchComposerAction({
        type: 'submit_failed',
        slot: panelSlot,
        message: getSafeDesktopActionErrorMessage(
          error,
          workbenchSurfaceCopy.panelSubmitErrorMessage,
        ),
      });
    }
  }

  return (
    <section className="screen screen-workbench">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">작업대</span>
          <h1>{workbenchSurfaceCopy.headline}</h1>
          <p>{workbenchSurfaceCopy.intro}</p>
        </div>
      </header>

      <div className="workbench-layout">
        <aside className="panel workbench-rail">
          <div className="panel-header panel-header-stack">
            <div>
              <span className="panel-kicker">최근 작업</span>
              <h3>{workbenchSurfaceCopy.railTitle}</h3>
              <p>{workbenchSurfaceCopy.railDescription}</p>
            </div>
            <span className="badge badge-muted">{surfaceState.railCountLabel}</span>
          </div>

          {surfaceState.showLoadingState ? (
            <article className="workbench-state-card">
              <span className="panel-kicker">불러오는 중</span>
              <strong>{workbenchSurfaceCopy.railLoadingTitle}</strong>
              <p>{workbenchSurfaceCopy.railLoadingBody}</p>
            </article>
          ) : null}

          {surfaceState.showErrorState ? (
            <article className="workbench-state-card workbench-state-card-error">
              <span className="panel-kicker">다시 확인 필요</span>
              <strong>{workbenchSurfaceCopy.railErrorTitle}</strong>
              <p>{workbenchErrorCopy.primary}</p>
              <QueryDiagnostic diagnostic={workbenchErrorCopy.diagnostic} />
            </article>
          ) : null}

          {surfaceState.showSyncWarningState ? (
            <article className="workbench-state-card workbench-state-card-error">
              <span className="panel-kicker">재동기화 필요</span>
              <strong>{workbenchSurfaceCopy.railSyncWarningTitle}</strong>
              <p>{workbenchSyncWarningCopy.primary}</p>
              <QueryDiagnostic diagnostic={workbenchSyncWarningCopy.diagnostic} />
              <button
                type="button"
                className="soft-button"
                onClick={() => {
                  void refreshWorkbenchLayout();
                }}
              >
                {workbenchSurfaceCopy.railSyncWarningAction}
              </button>
            </article>
          ) : null}

          {surfaceState.showInteractiveContent ? (
            <div className="task-rail">
              {surfaceState.recentTasks.length === 0 ? (
                <article className="workbench-state-card">
                  <span className="panel-kicker">비어 있음</span>
                  <strong>{workbenchSurfaceCopy.railEmptyTitle}</strong>
                  <p>{workbenchSurfaceCopy.railEmptyBody}</p>
                </article>
              ) : null}

              {surfaceState.recentTasks.map((task) => {
                const isTaskActive =
                  task.panelSlot !== null && task.panelSlot === surfaceState.activePanelSlot;

                return (
                  <button
                    key={task.taskId}
                    type="button"
                    className={`task-card workbench-task-card${isTaskActive ? ' workbench-task-card-active' : ''}`}
                    aria-pressed={isTaskActive}
                    onClick={() => {
                      void handleRecentTaskSelect(task.taskId);
                    }}
                  >
                    <div className="workbench-task-title-row">
                      <strong>{task.title}</strong>
                      <span className={task.isOpen ? 'badge badge-primary' : 'badge badge-muted'}>
                        {task.isOpen ? '열린 패널' : '빈 슬롯에 열기'}
                      </span>
                    </div>
                    <span className="workbench-task-meta">
                      {task.projectName} · {getWorkbenchStatusLabel(task.status)}
                    </span>
                    <span>{task.toolSummary}</span>
                    <span>
                      {task.lastActivity} · 예상 {task.savingsRate}% 절감
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </aside>

        <section className="workbench-stage">
          <article className="panel workbench-stage-card">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">대화 공간</span>
                <h3>{workbenchSurfaceCopy.stageTitle}</h3>
                <p>{workbenchSurfaceCopy.stageDescription}</p>
              </div>
              <span className="badge badge-primary">{surfaceState.stageBadgeLabel}</span>
            </div>

            {placementError ? (
              <div className="workbench-inline-error">
                <strong>{workbenchSurfaceCopy.railErrorTitle}</strong>
                <p>{placementError}</p>
              </div>
            ) : null}

            {surfaceState.showLoadingState ? (
              <div className="workbench-inline-state">
                <strong>{workbenchSurfaceCopy.railLoadingTitle}</strong>
                <p>{workbenchSurfaceCopy.railLoadingBody}</p>
              </div>
            ) : null}

            {surfaceState.showErrorState ? (
              <div className="workbench-inline-state workbench-inline-state-error">
                <strong>{workbenchSurfaceCopy.railErrorTitle}</strong>
                <p>{workbenchSurfaceCopy.railErrorBody}</p>
              </div>
            ) : null}

            {surfaceState.showSyncWarningState ? (
              <div className="workbench-inline-state workbench-inline-state-error">
                <strong>{workbenchSurfaceCopy.railSyncWarningTitle}</strong>
                <p>{workbenchSurfaceCopy.railSyncWarningBody}</p>
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    void refreshWorkbenchLayout();
                  }}
                >
                  {workbenchSurfaceCopy.railSyncWarningAction}
                </button>
              </div>
            ) : null}
          </article>

          {surfaceState.showInteractiveContent ? (
            <div className="workbench-grid">
              {surfaceState.panels.map((panel) => {
                const isActive = panel.slot === surfaceState.activePanelSlot;
                const taskSummary =
                  panel.taskId !== null
                    ? surfaceState.recentTasks.find((task) => task.taskId === panel.taskId) ?? null
                    : null;
                const latestRun = getLatestWorkbenchPanelRun(panel);
                const runFeedback =
                  latestRun && latestRun.status !== 'completed'
                    ? getChatRunFeedback(latestRun)
                    : latestRun?.status === 'failed'
                      ? getChatRunFeedback(latestRun)
                      : null;
                const activityItems = getWorkbenchPanelActivityItems(panel);
                const panelComposerState = composerState[panel.slot];
                const mergedMessages = mergeWorkbenchPanelMessages(
                  panel.conversation?.messages ?? [],
                  panelComposerState.pendingSubmission,
                );
                const conversationRunsById = new Map(
                  (panel.conversation?.runs ?? []).map((run) => [run.runId, run]),
                );
                const runBadgeLabel = getPanelRunBadgeLabel(latestRun);
                const canSubmit =
                  desktopClient.available &&
                  panel.conversation !== null &&
                  panelComposerState.draft.trim().length > 0 &&
                  panelComposerState.submitState.status !== 'submitting';

                return (
                  <article
                    key={panel.slot}
                    className={`panel workbench-panel${isActive ? ' workbench-panel-active' : ''}${panel.taskId === null ? ' workbench-panel-idle' : ''}`}
                  >
                    <div className="panel-header panel-header-stack">
                      <div>
                        <div className="workbench-panel-title-row">
                          <span className="panel-kicker">{workbenchSlotLabels[panel.slot]}</span>
                          <div className="workbench-panel-badges">
                            <span className={isActive ? 'badge badge-primary' : 'badge badge-muted'}>
                              {isActive ? '집중 패널' : '독립 패널'}
                            </span>
                            {runBadgeLabel ? (
                              <span className="badge badge-muted">{runBadgeLabel}</span>
                            ) : null}
                            {taskSummary ? (
                              <span className="badge badge-muted">
                                최근 활동 {taskSummary.lastActivity}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <h3>{panel.title}</h3>
                        <p>{panel.note}</p>
                      </div>
                    </div>

                    {taskSummary ? (
                      <>
                        <div className="workbench-panel-meta">
                          <span>{taskSummary.projectName}</span>
                          <span>{taskSummary.toolSummary}</span>
                          <span>
                            {taskSummary.lastActivity} · 예상 {taskSummary.savingsRate}% 절감
                          </span>
                        </div>

                        {runFeedback ? (
                          <article className={`run-status-card run-status-card-${runFeedback.tone}`}>
                            <div className="run-status-header">
                              <span className="badge badge-muted">{runFeedback.badgeLabel}</span>
                              <strong>{runFeedback.title}</strong>
                              <p>{runFeedback.description}</p>
                            </div>
                            <div className="run-status-steps">
                              {runFeedback.steps.map((step) => (
                                <span
                                  key={step.id}
                                  className={`run-status-step run-status-step-${step.state}`}
                                >
                                  {step.label}
                                </span>
                              ))}
                            </div>
                            {runFeedback.detail ? (
                              <p className="run-status-detail">{runFeedback.detail}</p>
                            ) : null}
                          </article>
                        ) : null}

                        <section className="workbench-panel-feed">
                          <div className="workbench-panel-section-header">
                            <span className="panel-kicker">대화 공간</span>
                            <span className="badge badge-muted">
                              {mergedMessages.length}개 메시지
                            </span>
                          </div>

                          {mergedMessages.length > 0 ? (
                            <div className="workbench-panel-feed-list">
                              {mergedMessages.map((message) => {
                                const responseRun = message.runId
                                  ? conversationRunsById.get(message.runId) ?? null
                                  : null;
                                const responseMetadata =
                                  message.role === 'assistant'
                                    ? getChatResponseMetadata(responseRun)
                                    : null;

                                return (
                                  <article
                                    key={message.messageId}
                                    className={
                                      message.role === 'user'
                                        ? 'bubble bubble-user workbench-bubble'
                                        : 'bubble bubble-history workbench-bubble'
                                    }
                                  >
                                    <span className="bubble-role">
                                      {message.role === 'user' ? '저장된 한국어 원문' : '복원된 한국어 응답'}
                                    </span>
                                    <p>{message.contentKo}</p>
                                    {message.role === 'user' &&
                                    panelComposerState.pendingSubmission?.messageId === message.messageId ? (
                                      <span className="bubble-meta">저장 중</span>
                                    ) : null}
                                    {responseMetadata ? (
                                      <div className="response-meta-row">
                                        {responseMetadata.items.map((item) => (
                                          <span
                                            key={item.id}
                                            className={
                                              item.tone === 'savings'
                                                ? 'response-meta-item response-meta-item-savings'
                                                : 'response-meta-item'
                                            }
                                          >
                                            {item.label}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })}
                            </div>
                          ) : (
                            <article className="workbench-state-card">
                              <span className="panel-kicker">대화 대기</span>
                              <strong>아직 이어진 대화가 없습니다</strong>
                              <p>채팅에서 시작한 요청이 이 패널에 연결되면 같은 작업 대화가 여기에 쌓입니다.</p>
                            </article>
                          )}
                        </section>

                        <section className="workbench-panel-activity">
                          <div className="workbench-panel-section-header">
                            <span className="panel-kicker">{workbenchSurfaceCopy.panelActivityTitle}</span>
                            <span className="badge badge-muted">
                              {activityItems.length}개 요약
                            </span>
                          </div>
                          <div className="workbench-activity-log">
                            {activityItems.map((item) => (
                              <article
                                key={item.id}
                                className={`workbench-activity-item workbench-activity-item-${item.tone}`}
                              >
                                <strong>{item.label}</strong>
                                <p>{item.detail}</p>
                              </article>
                            ))}
                          </div>
                        </section>

                        <section className="workbench-panel-compose">
                          <div className="workbench-panel-section-header">
                            <div>
                              <span className="panel-kicker">{workbenchSurfaceCopy.panelComposerTitle}</span>
                              <p>{workbenchSurfaceCopy.panelComposerBody}</p>
                            </div>
                            <span className="badge badge-muted">
                              {panel.conversation ? '같은 작업 이어짐' : '연결 대기'}
                            </span>
                          </div>

                          <textarea
                            aria-label={`${workbenchSlotLabels[panel.slot]} 추가 지시 초안`}
                            className="composer-input workbench-panel-input"
                            value={panelComposerState.draft}
                            onChange={(event) => {
                              dispatchComposerAction({
                                type: 'draft_changed',
                                slot: panel.slot,
                                draft: event.target.value,
                              });
                            }}
                            placeholder={workbenchSurfaceCopy.panelInputPlaceholder}
                          />

                          <div className="workbench-panel-compose-footer">
                            <div className="composer-meta">
                              <strong>{taskSummary.toolSummary}</strong>
                              <p>{workbenchSurfaceCopy.panelComposerBody}</p>
                              {panelComposerState.submitState.message ? (
                                <p className="composer-status">{panelComposerState.submitState.message}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="primary-button workbench-panel-submit"
                              onClick={() => {
                                void handlePanelSubmit(panel.slot);
                              }}
                              disabled={!canSubmit}
                            >
                              {panelComposerState.submitState.status === 'submitting'
                                ? '이어 붙이는 중…'
                                : workbenchSurfaceCopy.panelSubmitAction}
                            </button>
                          </div>
                        </section>

                        <div className="workbench-panel-toolbar">
                          <span className="panel-kicker">패널 이동</span>
                          <div className="toolbar-group workbench-panel-actions">
                            {Object.entries(workbenchSlotLabels).map(([slot, label]) => {
                              const targetSlot = slot as PanelSlot;
                              const isCurrentSlot = targetSlot === panel.slot;
                              const isPendingMove =
                                pendingPanelAction === `move:${panel.slot}:${targetSlot}`;

                              return (
                                <button
                                  key={targetSlot}
                                  type="button"
                                  className="ghost-chip"
                                  disabled={isCurrentSlot || pendingPanelAction !== null}
                                  aria-pressed={isCurrentSlot}
                                  onClick={() => {
                                    void handlePanelMove(panel.slot, targetSlot);
                                  }}
                                >
                                  {isPendingMove
                                    ? `${slotShortLabels[targetSlot]} 이동 중`
                                    : label}
                                </button>
                              );
                            })}

                            <button
                              type="button"
                              className="ghost-chip workbench-panel-close"
                              disabled={pendingPanelAction !== null}
                              onClick={() => {
                                void handlePanelClose(panel.slot);
                              }}
                            >
                              {pendingPanelAction === `close:${panel.slot}` ? '비우는 중' : '비우기'}
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="workbench-panel-meta workbench-panel-empty-meta">
                          <span>작업을 끌어오세요</span>
                          <span>또는 새 채팅을 열어 병렬 작업을 시작하세요</span>
                        </div>

                        <div className="workbench-panel-toolbar">
                          <span className="panel-kicker">빈 슬롯</span>
                          <div className="toolbar-group workbench-panel-actions">
                            <button type="button" className="ghost-chip" disabled>
                              최근 작업 대기
                            </button>
                            <button type="button" className="ghost-chip" disabled>
                              새 채팅은 채팅 화면에서 시작
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
