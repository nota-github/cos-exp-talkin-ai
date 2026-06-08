import type {
  BoardColumnsResult,
  OpenInWorkbenchCommand,
  OpenInWorkbenchResult,
  ProjectDetailResult,
  ProjectListResult,
  TaskStatus,
} from '../../shared/ipc/contracts';

type ProjectSurfaceQueryStatus = 'idle' | 'loading' | 'success' | 'error';
type BoardSurfaceQueryStatus = 'idle' | 'loading' | 'success' | 'error';

type ProjectHubSurfaceState = {
  showLoadingState: boolean;
  showErrorState: boolean;
  showEmptyState: boolean;
  showInteractiveContent: boolean;
  projects: ProjectListResult['projects'];
  recentTasks: ProjectListResult['recentTasks'];
  totalProjectCount: number;
  linkedTaskCount: number;
  unlinkedTaskCount: number;
  previewMode: boolean;
};

type BoardSurfaceState = {
  showLoadingState: boolean;
  showErrorState: boolean;
  showInteractiveContent: boolean;
  columns: BoardColumnsResult['columns'];
  totalTaskCount: number;
  activeTaskCount: number;
  completedTaskCount: number;
  emptyColumnCount: number;
  previewMode: boolean;
};

const boardStatusLabels: Record<TaskStatus, string> = {
  planning: '기획',
  in_progress: '진행 중',
  ai_review: 'AI 검토',
  human_review: '사람 검토',
  completed: '완료',
};

export const previewProjectList: ProjectListResult = {
  projects: [
    {
      projectId: 'project-001',
      name: '사업계획서',
      description: '파트너 제안서, 목차 정리, 수익 모델 검토를 한 묶음으로 관리',
      goal: '시장 진입 전략과 수익 모델 메시지를 하나의 흐름으로 묶기',
      taskCount: 2,
      fileCount: 2,
      updatedAt: '2026-06-08T05:04:00.000Z',
      lastActivityAt: '2026-06-08T05:10:00.000Z',
      lastActivity: '방금',
    },
    {
      projectId: 'project-002',
      name: '문서 요약',
      description: '긴 PDF 요약, 경쟁사 메모, 후속 질문을 정리하는 리서치 허브',
      goal: '핵심 문서를 1페이지 한국어 인사이트로 압축',
      taskCount: 1,
      fileCount: 1,
      updatedAt: '2026-06-08T04:52:00.000Z',
      lastActivityAt: '2026-06-08T04:52:00.000Z',
      lastActivity: '18분 전',
    },
    {
      projectId: 'project-003',
      name: '운영 공지',
      description: '운영 메시지와 카피 수정을 짧은 작업 단위로 모아보는 공간',
      goal: '짧지만 오해 없는 공지 톤 유지',
      taskCount: 1,
      fileCount: 0,
      updatedAt: '2026-06-08T04:10:00.000Z',
      lastActivityAt: '2026-06-08T04:10:00.000Z',
      lastActivity: '1시간 전',
    },
  ],
  recentTasks: [
    {
      taskId: 'preview-task-001',
      title: '운영 공지 카피 다듬기',
      status: 'planning',
      projectId: 'project-003',
      projectName: '운영 공지',
      sourceScreen: 'chat',
      lastActivity: '방금',
      lastActivityAt: '2026-06-08T05:10:00.000Z',
    },
    {
      taskId: 'preview-task-002',
      title: '긴 PDF 핵심 7개 항목으로 요약',
      status: 'in_progress',
      projectId: 'project-002',
      projectName: '문서 요약',
      sourceScreen: 'workbench',
      lastActivity: '18분 전',
      lastActivityAt: '2026-06-08T04:52:00.000Z',
    },
    {
      taskId: 'preview-task-003',
      title: '파트너 제안서 목차 점검',
      status: 'ai_review',
      projectId: 'project-001',
      projectName: '사업계획서',
      sourceScreen: 'kanban',
      lastActivity: '1시간 전',
      lastActivityAt: '2026-06-08T04:10:00.000Z',
    },
    {
      taskId: 'preview-task-005',
      title: '아직 프로젝트 없는 고객 FAQ 초안',
      status: 'human_review',
      projectId: null,
      projectName: null,
      sourceScreen: 'chat',
      lastActivity: '2시간 전',
      lastActivityAt: '2026-06-08T03:02:00.000Z',
    },
  ],
};

export const previewProjectDetails: Record<string, ProjectDetailResult> = {
  'project-001': {
    projectId: 'project-001',
    name: '사업계획서',
    description: '파트너 제안서, 목차 정리, 수익 모델 검토를 한 묶음으로 관리',
    goal: '시장 진입 전략과 수익 모델 메시지를 하나의 흐름으로 묶기',
    updatedAt: '2026-06-08T05:04:00.000Z',
    files: ['partner-brief.pdf', 'pricing-notes.docx'],
    tasks: [
      {
        taskId: 'preview-task-003',
        title: '파트너 제안서 목차 점검',
        status: 'ai_review',
        lastActivity: '1시간 전',
        lastActivityAt: '2026-06-08T04:10:00.000Z',
      },
      {
        taskId: 'preview-task-004',
        title: '요금 정책 FAQ 초안 정리',
        status: 'completed',
        lastActivity: '어제',
        lastActivityAt: '2026-06-07T14:00:00.000Z',
      },
    ],
  },
  'project-002': {
    projectId: 'project-002',
    name: '문서 요약',
    description: '긴 PDF 요약, 경쟁사 메모, 후속 질문을 정리하는 리서치 허브',
    goal: '핵심 문서를 1페이지 한국어 인사이트로 압축',
    updatedAt: '2026-06-08T04:52:00.000Z',
    files: ['research-pack.pdf'],
    tasks: [
      {
        taskId: 'preview-task-002',
        title: '긴 PDF 핵심 7개 항목으로 요약',
        status: 'in_progress',
        lastActivity: '18분 전',
        lastActivityAt: '2026-06-08T04:52:00.000Z',
      },
    ],
  },
  'project-003': {
    projectId: 'project-003',
    name: '운영 공지',
    description: '운영 메시지와 카피 수정을 짧은 작업 단위로 모아보는 공간',
    goal: '짧지만 오해 없는 공지 톤 유지',
    updatedAt: '2026-06-08T04:10:00.000Z',
    files: [],
    tasks: [
      {
        taskId: 'preview-task-001',
        title: '운영 공지 카피 다듬기',
        status: 'planning',
        lastActivity: '방금',
        lastActivityAt: '2026-06-08T05:10:00.000Z',
      },
    ],
  },
};

export function getProjectHubSurfaceState(options: {
  desktopAvailable: boolean;
  queryStatus: ProjectSurfaceQueryStatus;
  projectList: ProjectListResult | null;
  previewProjectListState?: ProjectListResult;
}): ProjectHubSurfaceState {
  const previewProjectListState = options.previewProjectListState ?? previewProjectList;

  if (options.desktopAvailable && options.projectList === null) {
    if (options.queryStatus === 'idle' || options.queryStatus === 'loading') {
      return {
        showLoadingState: true,
        showErrorState: false,
        showEmptyState: false,
        showInteractiveContent: false,
        projects: [],
        recentTasks: [],
        totalProjectCount: 0,
        linkedTaskCount: 0,
        unlinkedTaskCount: 0,
        previewMode: false,
      };
    }

    if (options.queryStatus === 'error') {
      return {
        showLoadingState: false,
        showErrorState: true,
        showEmptyState: false,
        showInteractiveContent: false,
        projects: [],
        recentTasks: [],
        totalProjectCount: 0,
        linkedTaskCount: 0,
        unlinkedTaskCount: 0,
        previewMode: false,
      };
    }
  }

  const projectList = options.projectList ?? previewProjectListState;
  const linkedTaskCount = projectList.recentTasks.filter((task) => task.projectId !== null).length;
  const unlinkedTaskCount = projectList.recentTasks.filter((task) => task.projectId === null).length;

  return {
    showLoadingState: false,
    showErrorState: false,
    showEmptyState: projectList.projects.length === 0,
    showInteractiveContent: true,
    projects: projectList.projects,
    recentTasks: projectList.recentTasks,
    totalProjectCount: projectList.projects.length,
    linkedTaskCount,
    unlinkedTaskCount,
    previewMode: !options.desktopAvailable,
  };
}

function createEmptyBoardColumns(): BoardColumnsResult['columns'] {
  return (Object.entries(boardStatusLabels) as Array<[TaskStatus, string]>).map(([status, title]) => ({
    status,
    title,
    cards: [],
  }));
}

export const previewBoardColumns: BoardColumnsResult = {
  columns: [
    {
      status: 'planning',
      title: '기획',
      cards: [
        {
          taskId: 'preview-task-001',
          conversationId: 'preview-conversation-001',
          title: '운영 공지 카피 다듬기',
          status: 'planning',
          projectName: '운영 공지',
          lastActivity: '방금',
          lastActivityAt: '2026-06-08T05:10:00.000Z',
          toolSummary: 'Gemini 1.5 Pro · 기본',
        },
      ],
    },
    {
      status: 'in_progress',
      title: '진행 중',
      cards: [
        {
          taskId: 'preview-task-002',
          conversationId: 'preview-conversation-002',
          title: '긴 PDF 핵심 7개 항목으로 요약',
          status: 'in_progress',
          projectName: '문서 요약',
          lastActivity: '18분 전',
          lastActivityAt: '2026-06-08T04:52:00.000Z',
          toolSummary: 'GPT-4.1 · 긴 컨텍스트',
        },
      ],
    },
    {
      status: 'ai_review',
      title: 'AI 검토',
      cards: [
        {
          taskId: 'preview-task-003',
          conversationId: 'preview-conversation-003',
          title: '파트너 제안서 목차 점검',
          status: 'ai_review',
          projectName: '사업계획서',
          lastActivity: '1시간 전',
          lastActivityAt: '2026-06-08T04:10:00.000Z',
          toolSummary: 'Claude Sonnet · 품질 우선',
        },
      ],
    },
    {
      status: 'human_review',
      title: '사람 검토',
      cards: [],
    },
    {
      status: 'completed',
      title: '완료',
      cards: [
        {
          taskId: 'preview-task-004',
          conversationId: 'preview-conversation-004',
          title: '요금 정책 FAQ 초안 정리',
          status: 'completed',
          projectName: '고객 지원',
          lastActivity: '어제',
          lastActivityAt: '2026-06-07T14:00:00.000Z',
          toolSummary: 'GPT-4.1 · 절감 우선',
        },
      ],
    },
  ],
};

export function getBoardStatusLabel(status: TaskStatus) {
  return boardStatusLabels[status];
}

export function getBoardSurfaceState(options: {
  desktopAvailable: boolean;
  queryStatus: BoardSurfaceQueryStatus;
  boardColumns: BoardColumnsResult | null;
  previewColumns?: BoardColumnsResult;
}): BoardSurfaceState {
  const previewColumns = options.previewColumns ?? previewBoardColumns;

  if (options.desktopAvailable && options.boardColumns === null) {
    if (options.queryStatus === 'idle' || options.queryStatus === 'loading') {
      return {
        showLoadingState: true,
        showErrorState: false,
        showInteractiveContent: false,
        columns: createEmptyBoardColumns(),
        totalTaskCount: 0,
        activeTaskCount: 0,
        completedTaskCount: 0,
        emptyColumnCount: 5,
        previewMode: false,
      };
    }

    if (options.queryStatus === 'error') {
      return {
        showLoadingState: false,
        showErrorState: true,
        showInteractiveContent: false,
        columns: createEmptyBoardColumns(),
        totalTaskCount: 0,
        activeTaskCount: 0,
        completedTaskCount: 0,
        emptyColumnCount: 5,
        previewMode: false,
      };
    }
  }

  const columns = options.boardColumns?.columns ?? previewColumns.columns;
  const totalTaskCount = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const completedTaskCount = columns.find((column) => column.status === 'completed')?.cards.length ?? 0;
  const emptyColumnCount = columns.filter((column) => column.cards.length === 0).length;

  return {
    showLoadingState: false,
    showErrorState: false,
    showInteractiveContent: true,
    columns,
    totalTaskCount,
    activeTaskCount: Math.max(0, totalTaskCount - completedTaskCount),
    completedTaskCount,
    emptyColumnCount,
    previewMode: !options.desktopAvailable,
  };
}

export async function openBoardTaskInWorkbench(options: {
  desktopAvailable: boolean;
  taskId: string | null;
  navigate: (path: string) => void;
  openInWorkbench: (request: OpenInWorkbenchCommand) => Promise<OpenInWorkbenchResult>;
}) {
  if (!options.desktopAvailable || !options.taskId) {
    return false;
  }

  await options.openInWorkbench({
    taskId: options.taskId,
  });
  options.navigate('/workbench');
  return true;
}

export function openBoardTaskInChat(options: {
  conversationId: string | null;
  navigate: (path: string) => void;
}) {
  if (!options.conversationId) {
    return false;
  }

  options.navigate(`/?conversationId=${encodeURIComponent(options.conversationId)}`);
  return true;
}
