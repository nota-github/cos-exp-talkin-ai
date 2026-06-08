import { useEffect, useState } from 'react';
import type { PanelSlot } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  getWorkbenchSurfaceState,
  getWorkbenchStatusLabel,
  placeWorkbenchTaskInPreview,
  previewWorkbenchLayout,
  workbenchSurfaceCopy,
} from './workbench-surface';

const slotLabels: Record<PanelSlot, string> = {
  'north-west': 'Panel A',
  'north-east': 'Panel B',
  'south-west': 'Panel C',
  'south-east': 'Panel D',
};

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
  const surfaceState = getWorkbenchSurfaceState({
    desktopAvailable: desktopClient.available,
    queryStatus: workbenchLayoutQuery.status,
    layout: workbenchLayoutQuery.data,
    previewLayout,
    activePanelSlot,
  });

  useEffect(() => {
    if (!surfaceState.layout?.activePanelSlot) {
      return;
    }

    setActivePanelSlot(surfaceState.layout.activePanelSlot);
  }, [surfaceState.layout?.activePanelSlot, surfaceState.layout?.updatedAt]);

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
      setPlacementError(error instanceof Error ? error.message : workbenchSurfaceCopy.railErrorBody);
    }
  }

  return (
    <section className="screen screen-workbench">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">Workbench</span>
          <h1>{workbenchSurfaceCopy.headline}</h1>
          <p>{workbenchSurfaceCopy.intro}</p>
        </div>
      </header>

      <div className="workbench-layout">
        <aside className="panel workbench-rail">
          <div className="panel-header panel-header-stack">
            <div>
              <span className="panel-kicker">Recent Tasks</span>
              <h3>{workbenchSurfaceCopy.railTitle}</h3>
              <p>{workbenchSurfaceCopy.railDescription}</p>
            </div>
            <span className="badge badge-muted">
              {surfaceState.railCountLabel}
            </span>
          </div>

          {surfaceState.showLoadingState ? (
            <article className="workbench-state-card">
              <span className="panel-kicker">Loading</span>
              <strong>{workbenchSurfaceCopy.railLoadingTitle}</strong>
              <p>{workbenchSurfaceCopy.railLoadingBody}</p>
            </article>
          ) : null}

          {surfaceState.showErrorState ? (
            <article className="workbench-state-card workbench-state-card-error">
              <span className="panel-kicker">Retry Safe</span>
              <strong>{workbenchSurfaceCopy.railErrorTitle}</strong>
              <p>{workbenchSurfaceCopy.railErrorBody}</p>
              {workbenchLayoutQuery.error ? (
                <span className="badge badge-muted">{workbenchLayoutQuery.error.message}</span>
              ) : null}
            </article>
          ) : null}

          {surfaceState.showInteractiveContent ? (
            <div className="task-rail">
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
                <span className="panel-kicker">Workspace</span>
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
          </article>

          {surfaceState.showInteractiveContent ? (
            <div className="workbench-grid">
              {surfaceState.panels.map((panel) => {
                const isActive = panel.slot === surfaceState.activePanelSlot;
                const taskSummary =
                  panel.taskId !== null
                    ? surfaceState.recentTasks.find((task) => task.taskId === panel.taskId) ?? null
                    : null;

                return (
                  <article
                    key={panel.slot}
                    className={`panel workbench-panel${isActive ? ' workbench-panel-active' : ''}${panel.taskId === null ? ' workbench-panel-idle' : ''}`}
                  >
                    <div className="panel-header">
                      <div>
                        <span className="panel-kicker">{slotLabels[panel.slot]}</span>
                        <h3>{panel.title}</h3>
                      </div>
                      <span className={isActive ? 'badge badge-primary' : 'badge badge-muted'}>
                        {isActive ? '집중 패널' : getWorkbenchStatusLabel(panel.status)}
                      </span>
                    </div>

                    <p>{panel.note}</p>

                    {taskSummary ? (
                      <div className="workbench-panel-meta">
                        <span>{taskSummary.projectName}</span>
                        <span>{taskSummary.toolSummary}</span>
                        <span>
                          {taskSummary.lastActivity} · 예상 {taskSummary.savingsRate}% 절감
                        </span>
                      </div>
                    ) : (
                      <div className="workbench-panel-meta workbench-panel-empty-meta">
                        <span>작업을 끌어오세요</span>
                        <span>또는 채팅에서 바로 이어 열기</span>
                      </div>
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
