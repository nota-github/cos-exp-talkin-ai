import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoardTaskCard, ProjectDetailResult, TaskStatus } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { getSafeDesktopErrorCopy } from '../lib/ipc/error-copy';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  filterProjectTasks,
  formatProjectFileSize,
  getBoardStatusLabel,
  getProjectDetailSurfaceState,
  getBoardSurfaceState,
  getProjectHubSurfaceState,
  getProjectTaskSourceLabel,
  openBoardTaskInChat,
  openBoardTaskInWorkbench,
  openProjectTaskInChat,
  openProjectTaskInWorkbench,
  previewProjectDetails,
} from './projects-surface';

type ProjectDraft = {
  name: string;
  description: string;
  goal: string;
};

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

const emptyProjectDraft: ProjectDraft = {
  name: '',
  description: '',
  goal: '',
};

function toProjectDraft(detail: ProjectDetailResult | null): ProjectDraft {
  if (!detail) {
    return emptyProjectDraft;
  }

  return {
    name: detail.name,
    description: detail.description,
    goal: detail.goal,
  };
}

function getProjectLinkActionLabel(
  selectedProjectId: string | null,
  currentProjectId: string | null,
) {
  if (!selectedProjectId) {
    return '프로젝트 선택 필요';
  }

  if (currentProjectId === selectedProjectId) {
    return '연결 해제';
  }

  if (currentProjectId === null) {
    return '이 프로젝트에 연결';
  }

  return '이 프로젝트로 옮기기';
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

export function ProjectsRoute() {
  const navigate = useNavigate();
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const boardDescriptor = createDesktopQueryDescriptor('getBoardColumns', {});
  const projectListDescriptor = createDesktopQueryDescriptor('getProjectList', {});
  const boardQuery = useDesktopQuery(
    queryCache,
    boardDescriptor,
    { enabled: desktopClient.available },
  );
  const projectListQuery = useDesktopQuery(
    queryCache,
    projectListDescriptor,
    { enabled: desktopClient.available },
  );
  const boardSurfaceState = getBoardSurfaceState({
    desktopAvailable: desktopClient.available,
    queryStatus: boardQuery.status,
    boardColumns: boardQuery.data,
  });
  const projectHubState = getProjectHubSurfaceState({
    desktopAvailable: desktopClient.available,
    queryStatus: projectListQuery.status,
    projectList: projectListQuery.data,
  });
  const [activeView, setActiveView] = useState<'hub' | 'board'>('hub');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyProjectDraft);
  const [projectTaskSearch, setProjectTaskSearch] = useState('');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [pendingFileIds, setPendingFileIds] = useState<Record<string, boolean>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isAttachingFile, setIsAttachingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resolvedSelectedProjectId =
    selectedProjectId ?? projectHubState.projects[0]?.projectId ?? null;
  const selectedProjectSummary = projectHubState.projects.find(
    (project) => project.projectId === resolvedSelectedProjectId,
  ) ?? null;
  const projectDetailDescriptor = createDesktopQueryDescriptor('getProjectDetail', {
    projectId: resolvedSelectedProjectId ?? '',
  });
  const projectDetailQuery = useDesktopQuery(
    queryCache,
    projectDetailDescriptor,
    {
      enabled:
        desktopClient.available &&
        !isCreatingProject &&
        resolvedSelectedProjectId !== null,
    },
  );
  const selectedProjectDetail = isCreatingProject
    ? null
    : desktopClient.available
      ? projectDetailQuery.data
      : (resolvedSelectedProjectId
          ? previewProjectDetails[resolvedSelectedProjectId] ?? null
          : null);

  useEffect(() => {
    if (isCreatingProject) {
      return;
    }

    const firstProjectId = projectHubState.projects[0]?.projectId ?? null;

    if (selectedProjectId && projectHubState.projects.some((project) => project.projectId === selectedProjectId)) {
      return;
    }

    if (firstProjectId !== selectedProjectId) {
      setSelectedProjectId(firstProjectId);
    }
  }, [isCreatingProject, projectHubState.projects, selectedProjectId]);

  useEffect(() => {
    if (isCreatingProject) {
      setProjectDraft(emptyProjectDraft);
      return;
    }

    setProjectDraft(toProjectDraft(selectedProjectDetail ?? null));
  }, [
    isCreatingProject,
    selectedProjectDetail?.projectId,
    selectedProjectDetail?.name,
    selectedProjectDetail?.description,
    selectedProjectDetail?.goal,
  ]);

  useEffect(() => {
    setProjectTaskSearch('');
  }, [isCreatingProject, resolvedSelectedProjectId]);

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

  async function handleOpenProjectTaskInWorkbench(taskId: string) {
    await openProjectTaskInWorkbench({
      desktopAvailable: desktopClient.available,
      navigate,
      openInWorkbench: desktopClient.commands.openInWorkbench,
      taskId,
    });
  }

  function handleOpenProjectTaskInChat(conversationId: string | null) {
    openProjectTaskInChat({
      conversationId,
      navigate,
    });
  }

  function handleSelectProject(projectId: string) {
    setActiveView('hub');
    setIsCreatingProject(false);
    setSelectedProjectId(projectId);
    setNotice(null);
  }

  function handleStartAttachFile() {
    if (!desktopClient.available || !resolvedSelectedProjectId || isAttachingFile) {
      return;
    }

    fileInputRef.current?.click();
  }

  async function handleAttachFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!selectedFile || !desktopClient.available || !resolvedSelectedProjectId) {
      return;
    }

    setIsAttachingFile(true);

    try {
      await desktopClient.commands.attachProjectFile({
        projectId: resolvedSelectedProjectId,
        file: {
          displayName: selectedFile.name,
          mimeType: selectedFile.type || 'application/octet-stream',
          bytes: new Uint8Array(await selectedFile.arrayBuffer()),
        },
      });
      setNotice({
        tone: 'success',
        message: `${selectedFile.name} 파일을 연결했습니다. 원본 로컬 파일은 그대로 두고 앱 보관본만 프로젝트에 추가했습니다.`,
      });
    } catch {
      setNotice({
        tone: 'error',
        message: '파일을 연결하지 못했습니다. 원본 파일은 그대로 있으니 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setIsAttachingFile(false);
    }
  }

  async function handleUnlinkProjectFile(fileId: string, displayName: string) {
    if (!desktopClient.available || !resolvedSelectedProjectId) {
      return;
    }

    setPendingFileIds((current) => ({
      ...current,
      [fileId]: true,
    }));

    try {
      await desktopClient.commands.unlinkProjectFile({
        projectId: resolvedSelectedProjectId,
        fileId,
      });
      setNotice({
        tone: 'success',
        message: `${displayName} 연결을 해제했습니다. 원본 로컬 파일은 삭제하지 않았습니다.`,
      });
    } catch {
      setNotice({
        tone: 'error',
        message: '파일 연결 해제를 저장하지 못했습니다. 원본 파일은 그대로 있고, 프로젝트 상태도 유지됩니다.',
      });
    } finally {
      setPendingFileIds((current) => ({
        ...current,
        [fileId]: false,
      }));
    }
  }

  function handleStartCreateProject() {
    setActiveView('hub');
    setIsCreatingProject(true);
    setSelectedProjectId(null);
    setProjectDraft(emptyProjectDraft);
    setNotice(null);
  }

  async function handleSaveProject() {
    if (!desktopClient.available) {
      return;
    }

    const nextDraft = {
      name: projectDraft.name.trim(),
      description: projectDraft.description.trim(),
      goal: projectDraft.goal.trim(),
    };

    if (!nextDraft.name) {
      setNotice({
        tone: 'error',
        message: '프로젝트 이름을 먼저 입력해 주세요.',
      });
      return;
    }

    setIsSavingProject(true);

    try {
      if (isCreatingProject) {
        const createdProject = await desktopClient.commands.createProject(nextDraft);

        setIsCreatingProject(false);
        setSelectedProjectId(createdProject.projectId);
        setNotice({
          tone: 'success',
          message: `${nextDraft.name} 프로젝트를 만들었습니다. 이제 기존 작업을 이 허브에 연결할 수 있습니다.`,
        });
        void queryCache.fetchQuery(projectListDescriptor);
        void queryCache.fetchQuery(
          createDesktopQueryDescriptor('getProjectDetail', {
            projectId: createdProject.projectId,
          }),
        );
        return;
      }

      if (!resolvedSelectedProjectId) {
        return;
      }

      await desktopClient.commands.updateProject({
        projectId: resolvedSelectedProjectId,
        ...nextDraft,
      });
      setNotice({
        tone: 'success',
        message: `${nextDraft.name} 프로젝트 정보를 저장했습니다.`,
      });
    } catch {
      setNotice({
        tone: 'error',
        message: '프로젝트 변경을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setIsSavingProject(false);
    }
  }

  async function handleSetTaskProject(taskId: string, nextProjectId: string | null) {
    if (!desktopClient.available) {
      return;
    }

    setPendingTaskIds((current) => ({
      ...current,
      [taskId]: true,
    }));
    setTaskErrors((current) => ({
      ...current,
      [taskId]: null,
    }));

    try {
      await desktopClient.commands.setTaskProject({
        taskId,
        projectId: nextProjectId,
      });

      const projectName = selectedProjectSummary?.name ?? '선택한 프로젝트';
      setNotice({
        tone: 'success',
        message:
          nextProjectId === null
            ? '작업을 프로젝트에서 분리했습니다.'
            : `${projectName}에 작업을 연결했습니다.`,
      });
    } catch {
      setTaskErrors((current) => ({
        ...current,
        [taskId]: '작업 연결 상태를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }));
      setNotice({
        tone: 'error',
        message: '작업 연결 상태를 저장하지 못했습니다. 같은 작업은 그대로 유지됩니다.',
      });
    } finally {
      setPendingTaskIds((current) => ({
        ...current,
        [taskId]: false,
      }));
    }
  }

  const linkedTasks = selectedProjectDetail?.tasks ?? [];
  const filteredLinkedTasks = filterProjectTasks(linkedTasks, projectTaskSearch);
  const recentProjectActivity = selectedProjectDetail?.recentActivity ?? [];
  const selectedProjectFiles = selectedProjectDetail?.files ?? [];
  const recentTasks = projectHubState.recentTasks.filter(
    (task) => task.projectId !== resolvedSelectedProjectId,
  );
  const projectDetailSurfaceState = getProjectDetailSurfaceState({
    desktopAvailable: desktopClient.available && !isCreatingProject,
    queryStatus: projectDetailQuery.status,
    projectDetail: projectDetailQuery.data,
    hasSelectedProject: resolvedSelectedProjectId !== null,
  });
  const projectListErrorCopy = getSafeDesktopErrorCopy(
    projectListQuery.error,
    '프로젝트 허브 목록을 다시 불러와 주세요.',
  );
  const projectListSyncWarningCopy = getSafeDesktopErrorCopy(
    projectListQuery.error,
    '최근 재조회가 실패해 마지막으로 확인된 프로젝트 허브 상태를 유지했습니다. 최신 연결 상태를 다시 확인해 주세요.',
  );
  const projectDetailErrorCopy = getSafeDesktopErrorCopy(
    projectDetailQuery.error,
    '선택한 프로젝트 상태를 다시 동기화해 주세요.',
  );
  const projectDetailSyncWarningCopy = getSafeDesktopErrorCopy(
    projectDetailQuery.error,
    '최근 재조회가 실패해 마지막으로 확인된 작업, 파일, 대화 맥락을 계속 보여주고 있습니다. 최신 상태를 다시 확인해 주세요.',
  );
  const boardErrorCopy = getSafeDesktopErrorCopy(
    boardQuery.error,
    '칸반 보드 상태를 다시 확인해 주세요.',
  );
  const boardSyncWarningCopy = getSafeDesktopErrorCopy(
    boardQuery.error,
    '최근 재조회가 실패해 마지막으로 확인된 작업 흐름을 유지했습니다. 상태 변경이 반영됐는지 다시 동기화해 주세요.',
  );
  const showProjectDetailLoading = projectDetailSurfaceState.showLoadingState;
  const showProjectDetailError = projectDetailSurfaceState.showErrorState;
  const showProjectDetailSyncWarning = projectDetailSurfaceState.showSyncWarningState;
  const canManageProjectFiles =
    desktopClient.available &&
    !isCreatingProject &&
    resolvedSelectedProjectId !== null &&
    !showProjectDetailLoading &&
    !showProjectDetailError;
  const fileAttachButtonLabel = isAttachingFile
    ? '파일 연결 중...'
    : selectedProjectFiles.length > 0
      ? '파일 추가'
      : '파일 연결';

  async function refreshProjectList() {
    await queryCache.fetchQuery(projectListDescriptor);
  }

  async function refreshBoard() {
    await queryCache.fetchQuery(boardDescriptor);
  }

  async function refreshProjectDetail() {
    await queryCache.fetchQuery(projectDetailDescriptor);
  }

  return (
    <section className="screen screen-projects">
      <header className="screen-header">
        <div>
          <span className="screen-kicker">프로젝트 허브</span>
          <h1>긴 한국어 작업을 묶고, 흐름과 연결 상태를 한 번에 정리하세요</h1>
          <p>
            프로젝트는 단순 설정 묶음이 아니라 장기 작업의 입구입니다. 채팅에서 시작한 작업을
            연결하고, 필요할 때만 보조 칸반으로 넘어가 같은 작업 흐름을 계속 관리합니다.
          </p>
          <div className="chip-row">
            <span className="badge badge-primary">프로젝트 목록 + 에디터</span>
            <span className="badge badge-success">작업 연결 상태 즉시 동기화</span>
            <span className="badge badge-muted">
              {projectHubState.previewMode ? '미리보기 모드' : '실시간 데스크탑 허브'}
            </span>
          </div>
          <div className="toolbar-group projects-view-toggle">
            <button
              type="button"
              aria-pressed={activeView === 'hub'}
              onClick={() => {
                setActiveView('hub');
              }}
            >
              프로젝트 묶음
            </button>
            <button
              type="button"
              aria-pressed={activeView === 'board'}
              onClick={() => {
                setActiveView('board');
              }}
            >
              보조 흐름 보드
            </button>
          </div>
        </div>

        <article className="hero-stat-card">
          {activeView === 'hub' ? (
            <>
              <span className="hero-stat-label">열린 프로젝트 허브</span>
              <strong>{projectHubState.totalProjectCount}개</strong>
              <p>
                연결된 작업 {projectHubState.linkedTaskCount}개 · 미지정 작업 {projectHubState.unlinkedTaskCount}개
              </p>
            </>
          ) : (
            <>
              <span className="hero-stat-label">활성 작업 흐름</span>
              <strong>{boardSurfaceState.activeTaskCount}개</strong>
              <p>
                완료 {boardSurfaceState.completedTaskCount}개 · 비어 있는 단계 {boardSurfaceState.emptyColumnCount}개
              </p>
            </>
          )}
        </article>
      </header>

      {activeView === 'hub' ? (
        <div className="project-hub-layout">
          <aside className="panel project-list-rail">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">프로젝트 목록</span>
                <h3>최근 활동 순으로 허브를 정렬합니다</h3>
                <p>연결된 작업 활동 또는 프로젝트 수정 시점을 기준으로 위로 올립니다.</p>
              </div>
              <button
                type="button"
                className="soft-button"
                onClick={handleStartCreateProject}
              >
                새 프로젝트 만들기
              </button>
            </div>

            {projectHubState.showLoadingState ? (
              <article className="project-state-card">
                <span className="panel-kicker">불러오는 중</span>
                <strong>프로젝트 허브 목록을 불러오는 중입니다</strong>
                <p>실제 저장 상태를 확인하는 동안에는 미리보기 목록을 섞지 않고 잠시 대기합니다.</p>
              </article>
            ) : null}

            {projectHubState.showErrorState ? (
              <article className="project-state-card project-state-card-error">
                <span className="panel-kicker">동기화 오류</span>
                <strong>프로젝트 허브 목록을 불러오지 못했습니다</strong>
                <p>{projectListErrorCopy.primary}</p>
                <QueryDiagnostic diagnostic={projectListErrorCopy.diagnostic} />
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    void refreshProjectList();
                  }}
                >
                  다시 불러오기
                </button>
              </article>
            ) : null}

            {projectHubState.showSyncWarningState ? (
              <article className="project-inline-feedback project-inline-feedback-error">
                <strong>마지막으로 동기화된 프로젝트 목록을 보여주고 있습니다</strong>
                <p>{projectListSyncWarningCopy.primary}</p>
                <QueryDiagnostic diagnostic={projectListSyncWarningCopy.diagnostic} />
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    void refreshProjectList();
                  }}
                >
                  프로젝트 허브 다시 동기화
                </button>
              </article>
            ) : null}

            {projectHubState.showInteractiveContent ? (
              <div className="project-list-stack">
                {projectHubState.showEmptyState ? (
                  <article className="project-list-empty">
                    <span className="panel-kicker">첫 프로젝트</span>
                    <strong>아직 만든 프로젝트가 없습니다</strong>
                      <p>먼저 장기 작업 묶음을 만들고, 그 다음 기존 채팅 작업을 여기에 연결해 보세요.</p>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleStartCreateProject}
                    >
                      첫 프로젝트 만들기
                    </button>
                  </article>
                ) : (
                  projectHubState.projects.map((project) => (
                    <button
                      key={project.projectId}
                      type="button"
                      className="project-list-card"
                      aria-pressed={!isCreatingProject && resolvedSelectedProjectId === project.projectId}
                      onClick={() => {
                        handleSelectProject(project.projectId);
                      }}
                    >
                      <div className="project-list-card-top">
                        <span className="panel-kicker">허브</span>
                        <span className="badge badge-muted">{project.taskCount}개 작업</span>
                      </div>
                      <strong>{project.name}</strong>
                      <p>{project.description}</p>
                      <div className="project-list-card-meta">
                        <span>최근 활동 {project.lastActivity}</span>
                        <span>파일 {project.fileCount}개</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </aside>

          <section className="project-editor-stage">
            <article className="panel project-editor-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">{isCreatingProject ? '새 프로젝트' : '프로젝트 에디터'}</span>
                  <h3>
                    {isCreatingProject
                      ? '장기 작업 허브를 새로 만듭니다'
                      : selectedProjectSummary?.name ?? '프로젝트를 선택하세요'}
                  </h3>
                  <p>
                    이름, 설명, 목표를 먼저 맞추고 나면 이후 작업 연결과 상세 허브 확장이 같은 축으로 이어집니다.
                  </p>
                </div>
                <span className="badge badge-primary">
                  {isCreatingProject
                    ? '저장 후 연결 시작'
                    : selectedProjectSummary
                      ? `최근 활동 ${selectedProjectSummary.lastActivity}`
                      : '프로젝트 선택 전'}
                </span>
              </div>

              {notice ? (
                <article className={`project-inline-feedback project-inline-feedback-${notice.tone}`}>
                  <strong>{notice.tone === 'success' ? '변경 반영 완료' : '저장 문제 발생'}</strong>
                  <p>{notice.message}</p>
                </article>
              ) : null}

              {showProjectDetailSyncWarning ? (
                <article className="project-inline-feedback project-inline-feedback-error">
                  <strong>마지막으로 동기화된 프로젝트 허브를 유지하고 있습니다</strong>
                  <p>{projectDetailSyncWarningCopy.primary}</p>
                  <QueryDiagnostic diagnostic={projectDetailSyncWarningCopy.diagnostic} />
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => {
                      void refreshProjectDetail();
                    }}
                  >
                    프로젝트 허브 다시 동기화
                  </button>
                </article>
              ) : null}

              {showProjectDetailLoading ? (
                <article className="project-state-card">
                  <span className="panel-kicker">불러오는 중</span>
                  <strong>선택한 프로젝트 세부 정보를 불러오는 중입니다</strong>
                  <p>연결된 작업과 파일 맥락을 정리하는 동안 잠시만 기다려 주세요.</p>
                </article>
              ) : null}

              {showProjectDetailError ? (
                <article className="project-state-card project-state-card-error">
                  <span className="panel-kicker">세부 정보 오류</span>
                  <strong>선택한 프로젝트 세부 정보를 불러오지 못했습니다</strong>
                  <p>{projectDetailErrorCopy.primary}</p>
                  <QueryDiagnostic diagnostic={projectDetailErrorCopy.diagnostic} />
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => {
                      void refreshProjectDetail();
                    }}
                  >
                    다시 불러오기
                  </button>
                </article>
              ) : null}

              {!showProjectDetailLoading &&
              !showProjectDetailError &&
              (isCreatingProject || selectedProjectDetail || projectHubState.showEmptyState) ? (
                <form
                  className="project-editor-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveProject();
                  }}
                >
                  <label className="project-form-field">
                    <span>프로젝트 이름</span>
                    <input
                      value={projectDraft.name}
                      onChange={(event) => {
                        setProjectDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }));
                      }}
                      placeholder="예: 사업계획서, 제품 리서치, 문서 요약"
                    />
                  </label>

                  <label className="project-form-field">
                    <span>설명</span>
                    <textarea
                      value={projectDraft.description}
                      rows={4}
                      onChange={(event) => {
                        setProjectDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }));
                      }}
                      placeholder="이 허브에서 어떤 한국어 작업 묶음을 관리할지 짧게 적어 주세요."
                    />
                  </label>

                  <label className="project-form-field">
                    <span>목표</span>
                    <textarea
                      value={projectDraft.goal}
                      rows={4}
                      onChange={(event) => {
                        setProjectDraft((current) => ({
                          ...current,
                          goal: event.target.value,
                        }));
                      }}
                      placeholder="프로젝트가 끝났을 때 어떤 상태가 되어야 하는지 한 줄로 정리하세요."
                    />
                  </label>

                  <div className="project-editor-actions">
                    <button
                      type="submit"
                      className="primary-button"
                      disabled={!desktopClient.available || isSavingProject}
                    >
                      {isSavingProject
                        ? '저장 중...'
                        : isCreatingProject
                          ? '프로젝트 허브 만들기'
                          : '프로젝트 변경 저장'}
                    </button>
                    {!isCreatingProject ? (
                      <button
                        type="button"
                        className="soft-button"
                        onClick={() => {
                          setProjectDraft(toProjectDraft(selectedProjectDetail ?? null));
                          setNotice(null);
                        }}
                      >
                        변경 취소
                      </button>
                    ) : null}
                  </div>

                  <div className="project-editor-footnote">
                    <span>프로젝트를 저장한 뒤 작업을 연결하면 이후 작업대, 칸반, 상세 허브가 같은 맥락을 공유합니다.</span>
                    <span>{desktopClient.available ? '실제 저장 가능' : '미리보기에서는 읽기 전용'}</span>
                  </div>
                </form>
              ) : null}
            </article>

            <article className="panel project-detail-hub">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">프로젝트 상세 허브</span>
                  <h3>
                    {isCreatingProject
                      ? '허브 저장 후 세부 맥락이 열립니다'
                      : selectedProjectSummary
                        ? `${selectedProjectSummary.name} 안에서 작업, 파일, 대화 흐름을 함께 봅니다`
                        : '프로젝트를 선택하면 세부 허브가 열립니다'}
                  </h3>
                  <p>
                    선택한 프로젝트 안에서 연결된 작업을 검색하고, 참고 파일과 최근 대화 맥락을
                    한 화면에서 이어서 확인할 수 있습니다.
                  </p>
                </div>
                <div className="project-detail-header-badges">
                  <span className="badge badge-primary">{linkedTasks.length}개 작업</span>
                  <span className="badge badge-success">
                    {selectedProjectDetail?.files.length ?? 0}개 파일
                  </span>
                </div>
              </div>

              {isCreatingProject ? (
                <article className="project-state-card">
                  <span className="panel-kicker">저장 후 허브 열림</span>
                  <strong>프로젝트를 저장하면 상세 허브가 바로 채워집니다</strong>
                  <p>먼저 이름과 목표를 저장한 뒤, 연결된 작업과 참고 파일 맥락을 이 영역에서 함께 관리하세요.</p>
                </article>
              ) : null}

              {!isCreatingProject && !selectedProjectSummary ? (
                <article className="project-state-card">
                  <span className="panel-kicker">허브 선택 필요</span>
                  <strong>왼쪽에서 프로젝트를 고르면 장기 작업 허브가 열립니다</strong>
                  <p>선택된 프로젝트마다 연결 작업 검색, 파일 확인, 최근 대화 맥락이 이 자리에서 함께 보입니다.</p>
                </article>
              ) : null}

              {showProjectDetailLoading ? (
                <article className="project-state-card">
                  <span className="panel-kicker">불러오는 중</span>
                  <strong>선택한 프로젝트 허브를 불러오는 중입니다</strong>
                  <p>연결된 작업, 파일, 최근 대화 맥락을 한 번에 정리하는 동안 잠시만 기다려 주세요.</p>
                </article>
              ) : null}

              {showProjectDetailError ? (
                <article className="project-state-card project-state-card-error">
                  <span className="panel-kicker">허브 동기화 오류</span>
                  <strong>프로젝트 상세 허브를 불러오지 못했습니다</strong>
                  <p>{projectDetailErrorCopy.primary}</p>
                  <QueryDiagnostic diagnostic={projectDetailErrorCopy.diagnostic} />
                  <button
                    type="button"
                    className="soft-button"
                    onClick={() => {
                      void refreshProjectDetail();
                    }}
                  >
                    다시 불러오기
                  </button>
                </article>
              ) : null}

              {!showProjectDetailLoading &&
              !showProjectDetailError &&
              !isCreatingProject &&
              selectedProjectDetail ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="visually-hidden"
                    tabIndex={-1}
                    onChange={(event) => {
                      void handleAttachFileSelection(event);
                    }}
                  />

                  <article className="project-detail-hero">
                    <div className="project-detail-hero-copy">
                      <span className="panel-kicker">허브 브리프</span>
                      <strong>{selectedProjectDetail.description || selectedProjectDetail.name}</strong>
                      <p>{selectedProjectDetail.goal || '아직 목표 설명이 없습니다. 상단 에디터에서 목표를 정리해 보세요.'}</p>
                    </div>
                    <div className="project-detail-hero-metrics">
                      <div className="project-detail-metric">
                        <span>연결된 작업</span>
                        <strong>{linkedTasks.length}</strong>
                      </div>
                      <div className="project-detail-metric">
                        <span>최근 맥락</span>
                        <strong>{recentProjectActivity.length}</strong>
                      </div>
                      <div className="project-detail-metric">
                        <span>참고 파일</span>
                        <strong>{selectedProjectDetail.files.length}</strong>
                      </div>
                    </div>
                  </article>

                  <div className="project-detail-grid">
                    <section className="project-detail-section project-detail-task-section">
                      <div className="project-detail-section-header">
                        <div>
                          <span className="panel-kicker">연결된 작업 검색</span>
                          <h4>이 프로젝트 안에서 바로 이어갈 작업</h4>
                        </div>
                        <span className="badge badge-muted">{filteredLinkedTasks.length}개 표시</span>
                      </div>

                      <label className="project-detail-search">
                        <span>작업 검색</span>
                        <input
                          value={projectTaskSearch}
                          onChange={(event) => {
                            setProjectTaskSearch(event.target.value);
                          }}
                          placeholder="제목, 요약, 상태, 시작 화면으로 검색"
                        />
                      </label>

                      {linkedTasks.length === 0 ? (
                        <article className="project-task-empty">
                          <span className="panel-kicker">연결된 작업 없음</span>
                          <strong>아직 이 프로젝트에 묶인 작업이 없습니다</strong>
                          <p>오른쪽 작업 연결 명령에서 필요한 작업을 이 허브로 묶으면 여기에서 바로 검색하고 이어갈 수 있습니다.</p>
                        </article>
                      ) : filteredLinkedTasks.length > 0 ? (
                        <div className="project-detail-task-list">
                          {filteredLinkedTasks.map((task) => (
                            <article
                              key={task.taskId}
                              className="project-detail-task-card"
                            >
                              <div className="project-detail-task-top">
                                <span className={`board-status-badge board-status-badge-${task.status}`}>
                                  {getBoardStatusLabel(task.status)}
                                </span>
                                <span className="project-detail-task-time">{task.lastActivity}</span>
                              </div>
                              <strong>{task.title}</strong>
                              <p>
                                {task.summary ??
                                  '아직 저장된 대화 요약이 없습니다. 작업대나 채팅에서 이 작업을 열어 맥락을 이어갈 수 있습니다.'}
                              </p>
                              <div className="project-detail-task-meta">
                                <span>시작 화면 {getProjectTaskSourceLabel(task.sourceScreen)}</span>
                                <span>{task.lastActivityAt.slice(0, 10)}</span>
                              </div>
                              <div className="project-detail-task-actions">
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={!desktopClient.available}
                                  onClick={() => {
                                    void handleOpenProjectTaskInWorkbench(task.taskId);
                                  }}
                                >
                                  작업대에서 이어가기
                                </button>
                                <button
                                  type="button"
                                  className="soft-button"
                                  disabled={!task.conversationId}
                                  onClick={() => {
                                    handleOpenProjectTaskInChat(task.conversationId);
                                  }}
                                >
                                  대화 열기
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <article className="project-task-empty">
                          <span className="panel-kicker">검색 결과 없음</span>
                          <strong>이 검색어와 맞는 작업이 아직 없습니다</strong>
                          <p>다른 키워드로 다시 찾거나 오른쪽 인박스에서 새 작업을 이 프로젝트에 연결해 보세요.</p>
                        </article>
                      )}
                    </section>

                    <div className="project-detail-side">
                      <section className="project-detail-section">
                        <div className="project-detail-section-header">
                          <div>
                            <span className="panel-kicker">참고 파일</span>
                            <h4>프로젝트와 함께 보는 문서</h4>
                            <p className="project-file-section-copy">
                              문서 관리 화면처럼 확장하지 않고, 지금 작업에 필요한 참고 자료만 가볍게 연결합니다.
                            </p>
                          </div>
                          <div className="project-file-toolbar">
                            <span className="badge badge-muted">{selectedProjectFiles.length}개</span>
                            <button
                              type="button"
                              className="soft-button"
                              disabled={!canManageProjectFiles || isAttachingFile}
                              onClick={handleStartAttachFile}
                            >
                              {fileAttachButtonLabel}
                            </button>
                          </div>
                        </div>

                        {selectedProjectFiles.length > 0 ? (
                          <div className="project-file-list">
                            {selectedProjectFiles.map((file) => (
                              <article
                                key={file.fileId}
                                className="project-file-card"
                              >
                                <div className="project-file-card-top">
                                  <strong>{file.displayName}</strong>
                                  <button
                                    type="button"
                                    className="soft-button"
                                    disabled={!canManageProjectFiles || pendingFileIds[file.fileId] === true}
                                    onClick={() => {
                                      void handleUnlinkProjectFile(file.fileId, file.displayName);
                                    }}
                                  >
                                    {pendingFileIds[file.fileId] === true ? '해제 중...' : '연결 해제'}
                                  </button>
                                </div>
                                <div className="project-file-meta">
                                  <span>{file.mimeType}</span>
                                  <span>{formatProjectFileSize(file.sizeBytes)}</span>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <article className="project-file-empty">
                            <span className="panel-kicker">아직 없음</span>
                            <strong>첫 참고 파일이 아직 없습니다</strong>
                            <p>필요한 문서 한두 개만 먼저 연결해 두면, 이 프로젝트 안에서 다시 참고할 맥락이 바로 모입니다.</p>
                            <div className="project-file-action-row">
                              <button
                                type="button"
                                className="primary-button"
                                disabled={!canManageProjectFiles || isAttachingFile}
                                onClick={handleStartAttachFile}
                              >
                                {isAttachingFile ? '파일 연결 중...' : '첫 파일 연결'}
                              </button>
                              <span>
                                {desktopClient.available
                                  ? '원본 로컬 파일은 삭제하지 않고, 앱 보관본만 이 프로젝트에 연결합니다.'
                                  : '미리보기에서는 파일 연결을 실행하지 않습니다.'}
                              </span>
                            </div>
                          </article>
                        )}

                        {selectedProjectFiles.length > 0 ? (
                          <p className="project-file-policy">
                            원본 로컬 파일은 그대로 두고 앱 보관본만 연결합니다. 연결 해제는 프로젝트 목록에서만 제거되며, 원본 파일은 삭제하지 않습니다.
                          </p>
                        ) : null}
                      </section>

                      <section className="project-detail-section">
                        <div className="project-detail-section-header">
                          <div>
                            <span className="panel-kicker">최근 대화 맥락</span>
                            <h4>방금 이어진 의도와 후속 지시</h4>
                          </div>
                          <span className="badge badge-muted">{recentProjectActivity.length}개</span>
                        </div>

                        {recentProjectActivity.length > 0 ? (
                          <div className="project-context-list">
                            {recentProjectActivity.map((activity) => (
                              <article
                                key={activity.activityId}
                                className="project-context-card"
                              >
                                <div className="project-context-top">
                                  <strong>{activity.title}</strong>
                                  <span>{activity.timestampLabel}</span>
                                </div>
                                <p>{activity.summary}</p>
                                <div className="project-context-actions">
                                  <button
                                    type="button"
                                    className="soft-button"
                                    disabled={!activity.taskId || !desktopClient.available}
                                    onClick={() => {
                                      if (!activity.taskId) {
                                        return;
                                      }

                                      void handleOpenProjectTaskInWorkbench(activity.taskId);
                                    }}
                                  >
                                    작업대 열기
                                  </button>
                                  <button
                                    type="button"
                                    className="soft-button"
                                    disabled={!activity.conversationId}
                                    onClick={() => {
                                      handleOpenProjectTaskInChat(activity.conversationId);
                                    }}
                                  >
                                    대화 열기
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <article className="project-task-empty">
                            <span className="panel-kicker">맥락 없음</span>
                            <strong>아직 최근 대화 맥락이 충분히 쌓이지 않았습니다</strong>
                            <p>이 프로젝트에 작업을 연결하고 대화를 한 번이라도 이어가면 최근 의도와 흐름이 여기로 모입니다.</p>
                          </article>
                        )}
                      </section>
                    </div>
                  </div>
                </>
              ) : null}
            </article>
          </section>

          <aside className="panel project-task-command-stage">
            <div className="panel-header panel-header-stack">
              <div>
                <span className="panel-kicker">작업 연결 명령</span>
                <h3>허브에 넣을 작업과 뺄 작업을 여기서 정리합니다</h3>
                <p>한 작업은 하나의 프로젝트에만 연결됩니다. 필요하면 다른 허브에서 이쪽으로 바로 옮길 수 있습니다.</p>
              </div>
              <span className="badge badge-success">
                {selectedProjectSummary ? `${selectedProjectSummary.name} 기준` : '프로젝트 선택 전'}
              </span>
            </div>

            {isCreatingProject ? (
              <article className="project-state-card">
                <span className="panel-kicker">저장 후 연결</span>
                <strong>먼저 프로젝트 허브를 저장하세요</strong>
                <p>프로젝트가 만들어진 뒤부터 기존 채팅 작업을 이 허브에 연결하거나 다시 분리할 수 있습니다.</p>
              </article>
            ) : null}

            {!isCreatingProject && !selectedProjectSummary ? (
              <article className="project-state-card">
                <span className="panel-kicker">허브 선택 필요</span>
                <strong>어느 프로젝트에 연결할지 먼저 고르세요</strong>
                <p>왼쪽 목록에서 허브를 선택하면 연결된 작업과 최근 작업 명령이 함께 열립니다.</p>
              </article>
            ) : null}

            {!isCreatingProject && selectedProjectSummary ? (
              <div className="project-task-command-layout">
                <section className="project-task-section">
                  <div className="project-task-section-header">
                    <strong>현재 연결된 작업</strong>
                    <span>{linkedTasks.length}개</span>
                  </div>
                  {linkedTasks.length > 0 ? (
                    linkedTasks.map((task) => {
                      const isPending = pendingTaskIds[task.taskId] === true;
                      const errorMessage = taskErrors[task.taskId] ?? null;

                      return (
                        <article
                          key={task.taskId}
                          className="project-task-command-card"
                        >
                          <div className="project-task-command-top">
                            <span className={`board-status-badge board-status-badge-${task.status}`}>
                              {getBoardStatusLabel(task.status)}
                            </span>
                            <span className="project-task-command-meta">{task.lastActivity}</span>
                          </div>
                          <strong>{task.title}</strong>
                          <p>이미 이 허브 안에 있는 작업입니다. 필요하면 바로 연결을 해제해 다른 프로젝트로 옮길 수 있습니다.</p>
                          <div className="project-task-command-actions">
                            <button
                              type="button"
                              className="soft-button"
                              disabled={!desktopClient.available || isPending}
                              onClick={() => {
                                void handleSetTaskProject(task.taskId, null);
                              }}
                            >
                              연결 해제
                            </button>
                          </div>
                          {errorMessage ? <p className="project-task-command-error">{errorMessage}</p> : null}
                        </article>
                      );
                    })
                  ) : (
                    <article className="project-task-empty">
                      <span className="panel-kicker">아직 없음</span>
                      <strong>이 허브에 연결된 작업이 없습니다</strong>
                      <p>아래 최근 작업 목록에서 필요한 작업을 골라 이 허브로 바로 연결해 보세요.</p>
                    </article>
                  )}
                </section>

                <section className="project-task-section">
                  <div className="project-task-section-header">
                    <strong>최근 작업 인박스</strong>
                    <span>{recentTasks.length}개</span>
                  </div>
                  {recentTasks.length > 0 ? (
                    recentTasks.map((task) => {
                      const isPending = pendingTaskIds[task.taskId] === true;
                      const errorMessage = taskErrors[task.taskId] ?? null;
                      const actionLabel = getProjectLinkActionLabel(
                        resolvedSelectedProjectId,
                        task.projectId,
                      );

                      return (
                        <article
                          key={task.taskId}
                          className="project-task-command-card"
                        >
                          <div className="project-task-command-top">
                            <span className={`board-status-badge board-status-badge-${task.status}`}>
                              {getBoardStatusLabel(task.status)}
                            </span>
                            <span className="project-task-command-meta">{task.lastActivity}</span>
                          </div>
                          <strong>{task.title}</strong>
                          <p>
                            현재 위치 {task.projectName ?? '개인 작업'} · 시작 화면{' '}
                            {getProjectTaskSourceLabel(task.sourceScreen)}
                          </p>
                          <div className="project-task-command-actions">
                            <button
                              type="button"
                              className="primary-button"
                              disabled={!desktopClient.available || !resolvedSelectedProjectId || isPending}
                              onClick={() => {
                                void handleSetTaskProject(
                                  task.taskId,
                                  task.projectId === resolvedSelectedProjectId ? null : resolvedSelectedProjectId,
                                );
                              }}
                            >
                              {actionLabel}
                            </button>
                          </div>
                          {errorMessage ? <p className="project-task-command-error">{errorMessage}</p> : null}
                        </article>
                      );
                    })
                  ) : (
                    <article className="project-task-empty">
                      <span className="panel-kicker">최근 작업 없음</span>
                      <strong>연결할 최근 작업이 아직 없습니다</strong>
                      <p>채팅이나 작업대에서 새 작업을 시작하면 이 목록으로 바로 들어옵니다.</p>
                    </article>
                  )}
                </section>
              </div>
            ) : null}
          </aside>
        </div>
      ) : (
        <div className="projects-workspace">
          <aside className="panel board-overview">
            <div className="panel-header panel-header-stack">
              <div>
                <span className="panel-kicker">흐름 원칙</span>
                <h3>상태만 옮기고, 대화는 그대로 둡니다</h3>
                <p>칸반은 별도 흐름 저장소를 만들지 않고 같은 작업 상태만 갱신합니다.</p>
              </div>
              <span className="badge badge-primary">{boardSurfaceState.totalTaskCount}개 작업 추적 중</span>
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
                <span className="panel-kicker">프로젝트 허브와 관계</span>
                <strong>프로젝트 묶음 안에서 흐름만 보조로 관리합니다</strong>
                <p>프로젝트 허브에서 작업 맥락을 정리하고, 여기서는 같은 작업을 단계별로만 이동합니다.</p>
              </article>

              <article className="board-overview-card">
                <span className="panel-kicker">진입 액션</span>
                <strong>필요한 순간에만 대화로 돌아갑니다</strong>
                <p>카드에서 바로 작업대 또는 상세 대화를 열어 같은 작업을 이어갈 수 있습니다.</p>
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
                {boardSurfaceState.previewMode ? (
                  <span className="badge badge-muted">브리지 없이 읽기 전용 미리보기</span>
                ) : null}
              </div>
            </header>

            {boardSurfaceState.showLoadingState ? (
              <article className="panel board-placeholder">
                <span className="panel-kicker">불러오는 중</span>
                <strong>칸반 보드를 불러오는 중입니다</strong>
                <p>실제 작업 상태를 동기화하는 동안에는 미리보기 카드를 섞지 않고 잠시 대기합니다.</p>
              </article>
            ) : null}

            {boardSurfaceState.showErrorState ? (
              <article className="panel board-placeholder">
                <span className="panel-kicker">동기화 오류</span>
                <strong>흐름 보드를 불러오지 못했습니다</strong>
                <p>{boardErrorCopy.primary}</p>
                <QueryDiagnostic diagnostic={boardErrorCopy.diagnostic} />
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    void refreshBoard();
                  }}
                >
                  다시 불러오기
                </button>
              </article>
            ) : null}

            {boardSurfaceState.showSyncWarningState ? (
              <article className="project-inline-feedback project-inline-feedback-error">
                <strong>마지막으로 동기화된 칸반 상태를 보여주고 있습니다</strong>
                <p>{boardSyncWarningCopy.primary}</p>
                <QueryDiagnostic diagnostic={boardSyncWarningCopy.diagnostic} />
                <button
                  type="button"
                  className="soft-button"
                  onClick={() => {
                    void refreshBoard();
                  }}
                >
                  칸반 다시 동기화
                </button>
              </article>
            ) : null}

            {boardSurfaceState.showInteractiveContent ? (
              <div className="board-stage-scroll">
                <div className="board-grid">
                  {boardSurfaceState.columns.map((column) => (
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
      )}
    </section>
  );
}
