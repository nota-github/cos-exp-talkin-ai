import type {
  BoardColumnsResult,
  OpenInWorkbenchCommand,
  OpenInWorkbenchResult,
  TaskStatus,
} from '../../shared/ipc/contracts';

type BoardSurfaceQueryStatus = 'idle' | 'loading' | 'success' | 'error';

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
