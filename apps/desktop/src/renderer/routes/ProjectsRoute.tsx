import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardTaskCard, TaskStatus } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  getBoardStatusLabel,
  getBoardSurfaceState,
  openBoardTaskInChat,
  openBoardTaskInWorkbench,
} from './projects-surface';

const boardStepDescriptions: Record<TaskStatus, string> = {
  planning: '작업 의도와 산출물 형태를 정리하는 단계',
  in_progress: '로컬 최적화와 모델 추론이 실제로 진행 중인 단계',
  ai_review: 'AI 초안을 다시 점검하고 보강할 포인트를 보는 단계',
  human_review: '사람이 최종 문장과 근거를 확인하는 단계',
  completed: '작업 흐름이 정리되어 다시 열어볼 준비가 된 단계',
};

const statusOptions: Array<{ value: TaskStatus; label: string }> = [
  { value: 'planning', label: '기획' },
  { value: 'in_progress', label: '진행 중' },
  { value: 'ai_review', label: 'AI 검토' },
  { value: 'human_review', label: '사람 검토' },
  { value: 'completed', label: '완료' },
];

export function ProjectsRoute() {
  const navigate = useNavigate();
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const boardDescriptor = createDesktopQueryDescriptor('getBoardColumns', {});
  const boardQuery = useDesktopQuery(
    queryCache,
    boardDescriptor,
    { enabled: desktopClient.available },
  );
  const surfaceState = getBoardSurfaceState({
    desktopAvailable: desktopClient.available,
    queryStatus: boardQuery.status,
    boardColumns: boardQuery.data,
  });
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  async function handleMoveTaskStatus(card: BoardTaskCard, nextStatus: TaskStatus) {
    if (!desktopClient.available || nextStatus === card.status) {
      return;
    }

    setPendingTaskIds((current) => ({
      ...current,
      [card.taskId]: true,
    }));
    setTaskErrors((current) => ({
      ...current,
      [card.taskId]: null,
    }));

    try {
      await desktopClient.commands.moveTaskStatus({
        taskId: card.taskId,
        status: nextStatus,
      });
      setNotice({
        tone: 'success',
        message: `${card.title}을 ${getBoardStatusLabel(nextStatus)} 단계로 옮겼습니다.`,
      });
    } catch {
      setTaskErrors((current) => ({
        ...current,
        [card.taskId]: '상태를 저장하지 못했습니다. 같은 작업은 그대로 남아 있으니 다시 시도해 주세요.',
      }));
      setNotice({
        tone: 'error',
        message: '칸반 상태 변경을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setPendingTaskIds((current) => ({
        ...current,
        [card.taskId]: false,
      }));
    }
  }

  async function handleOpenInWorkbench(card: BoardTaskCard) {
    await openBoardTaskInWorkbench({
      desktopAvailable: desktopClient.available,
      navigate,
      openInWorkbench: desktopClient.commands.openInWorkbench,
      taskId: card.taskId,
    });
  }

  function handleOpenInChat(card: BoardTaskCard) {
    openBoardTaskInChat({
      conversationId: card.conversationId,
      navigate,
    });
  }

  return (
    <section className="screen screen-projects">
      <header className="screen-header">
        <div>
          <span className="screen-kicker">칸반 보드</span>
          <h1>대화는 채팅에서, 흐름은 여기서 정리하세요</h1>
          <p>
            같은 한국어 작업을 기획부터 완료까지 옮기며 상태만 조정합니다. 이 화면은 대화창이 아니라
            장기 작업의 흐름과 검토 단계를 한눈에 맞추는 관리 화면입니다.
          </p>
          <div className="chip-row">
            <span className="badge badge-primary">상태 기반 보드</span>
            <span className="badge badge-success">채팅과 작업대의 같은 작업 유지</span>
            <span className="badge badge-muted">
              {surfaceState.previewMode ? '미리보기 모드' : '실시간 동기화'}
            </span>
          </div>
        </div>

        <article className="hero-stat-card">
          <span className="hero-stat-label">활성 작업 흐름</span>
          <strong>{surfaceState.activeTaskCount}개</strong>
          <p>
            완료 {surfaceState.completedTaskCount}개 · 비어 있는 단계 {surfaceState.emptyColumnCount}개
          </p>
        </article>
      </header>

      <div className="projects-workspace">
        <aside className="panel board-overview">
          <div className="panel-header panel-header-stack">
            <div>
              <span className="panel-kicker">흐름 원칙</span>
              <h3>상태만 옮기고, 대화는 그대로 둡니다</h3>
              <p>칸반은 별도 흐름 저장소를 만들지 않고 같은 작업 상태만 갱신합니다.</p>
            </div>
            <span className="badge badge-primary">{surfaceState.totalTaskCount}개 작업 추적 중</span>
          </div>

          {notice ? (
            <article className={`board-feedback board-feedback-${notice.tone}`}>
              <strong>{notice.tone === 'success' ? '상태 반영 완료' : '저장 문제 발생'}</strong>
              <p>{notice.message}</p>
            </article>
          ) : null}

          <div className="board-overview-stack">
            <article className="board-overview-card">
              <span className="panel-kicker">왜 여기서 보나요</span>
              <strong>채팅과 다른 역할이 바로 읽혀야 합니다</strong>
              <p>답변 내용을 읽는 곳이 아니라, 여러 작업이 어느 검토 단계에 있는지 빠르게 조율하는 공간입니다.</p>
            </article>

            <article className="board-overview-card">
              <span className="panel-kicker">진입 액션</span>
              <strong>필요한 순간에만 대화로 돌아갑니다</strong>
              <p>카드에서 바로 작업대 또는 상세 대화를 열어 같은 작업을 이어갈 수 있습니다.</p>
            </article>

            <article className="board-overview-card">
              <span className="panel-kicker">다음 스토리</span>
              <strong>프로젝트 허브 확장은 뒤에서 이어집니다</strong>
              <p>이번 런은 칸반 흐름 관리에만 집중하고, 프로젝트 생성/편집과 상세 허브는 다음 스토리로 남깁니다.</p>
            </article>
          </div>
        </aside>

        <section className="board-stage">
          <header className="panel board-stage-header">
            <div>
              <span className="panel-kicker">흐름 보드</span>
              <h3>다섯 단계로 작업 흐름을 정렬합니다</h3>
              <p>빈 단계도 그대로 보여 주어 현재 병목이 어디인지 바로 읽을 수 있게 했습니다.</p>
            </div>
            <div className="board-stage-badges">
              <span className="badge badge-success">상태 변경 즉시 동기화</span>
              {surfaceState.previewMode ? (
                <span className="badge badge-muted">브리지 없이 읽기 전용 미리보기</span>
              ) : null}
            </div>
          </header>

          {surfaceState.showLoadingState ? (
            <article className="panel board-placeholder">
              <span className="panel-kicker">불러오는 중</span>
              <strong>칸반 보드를 불러오는 중입니다</strong>
              <p>실제 작업 상태를 동기화하는 동안에는 미리보기 카드를 섞지 않고 잠시 대기합니다.</p>
            </article>
          ) : null}

          {surfaceState.showErrorState ? (
            <article className="panel board-placeholder">
              <span className="panel-kicker">동기화 오류</span>
              <strong>흐름 보드를 불러오지 못했습니다</strong>
              <p>{boardQuery.error?.message ?? '데스크탑 브리지 응답을 다시 확인해 주세요.'}</p>
              <button
                type="button"
                className="soft-button"
                onClick={() => {
                  void queryCache.fetchQuery(boardDescriptor);
                }}
              >
                다시 불러오기
              </button>
            </article>
          ) : null}

          {surfaceState.showInteractiveContent ? (
            <div className="board-stage-scroll">
              <div className="board-grid">
                {surfaceState.columns.map((column) => (
                  <article
                    key={column.status}
                    className={`board-column board-column-${column.status}`}
                  >
                    <div className="board-column-header">
                      <div>
                        <span className="panel-kicker">단계</span>
                        <h3>{column.title}</h3>
                      </div>
                      <span className="badge badge-muted">{column.cards.length}개</span>
                    </div>

                    <p className="board-column-copy">{boardStepDescriptions[column.status]}</p>

                    <div className="board-column-body">
                      {column.cards.length > 0 ? (
                        column.cards.map((card) => {
                          const isPending = pendingTaskIds[card.taskId] === true;
                          const errorMessage = taskErrors[card.taskId] ?? null;

                          return (
                            <article
                              key={card.taskId}
                              className="board-card"
                            >
                              <div className="board-card-top">
                                <span className="board-card-project">{card.projectName}</span>
                                <span className={`board-status-badge board-status-badge-${card.status}`}>
                                  {getBoardStatusLabel(card.status)}
                                </span>
                              </div>

                              <strong>{card.title}</strong>

                              <div className="board-card-meta">
                                <span>{card.toolSummary}</span>
                                <span>{card.lastActivity}</span>
                              </div>

                              <label className="board-status-control">
                                <span>상태 이동</span>
                                <select
                                  aria-label={`${card.title} status`}
                                  className="board-status-select"
                                  value={card.status}
                                  disabled={!desktopClient.available || isPending}
                                  onChange={(event) => {
                                    void handleMoveTaskStatus(card, event.target.value as TaskStatus);
                                  }}
                                >
                                  {statusOptions.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="board-card-actions">
                                <button
                                  type="button"
                                  className="primary-button board-action-button"
                                  disabled={!desktopClient.available || isPending}
                                  onClick={() => {
                                    void handleOpenInWorkbench(card);
                                  }}
                                >
                                  작업대 열기
                                </button>
                                <button
                                  type="button"
                                  className="soft-button board-action-button"
                                  disabled={!card.conversationId || isPending}
                                  onClick={() => {
                                    handleOpenInChat(card);
                                  }}
                                >
                                  대화 열기
                                </button>
                              </div>

                              {errorMessage ? <p className="board-card-error">{errorMessage}</p> : null}
                            </article>
                          );
                        })
                      ) : (
                        <article className="board-column-empty">
                          <span className="panel-kicker">빈 단계</span>
                          <strong>아직 이 단계의 작업이 없습니다</strong>
                          <p>다른 단계의 작업을 옮기면 여기에도 같은 작업으로 바로 반영됩니다.</p>
                        </article>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
