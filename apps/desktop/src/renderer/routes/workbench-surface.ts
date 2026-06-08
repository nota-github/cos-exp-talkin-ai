import type {
  PanelSlot,
  TaskStatus,
  WorkbenchLayoutResult,
  WorkbenchPanel,
  WorkbenchRecentTask,
} from '../../shared/ipc/contracts.ts';
import { resolveWorkbenchPanelSlot } from '../../shared/ipc/workbench.ts';

export type WorkbenchRouteQueryStatus = 'idle' | 'loading' | 'success' | 'error';

type PreviewTaskSeed = Omit<WorkbenchRecentTask, 'isOpen' | 'panelSlot'> & {
  panelSlot: PanelSlot | null;
};

const previewTaskSeeds: PreviewTaskSeed[] = [
  {
    taskId: 'task-003',
    title: '운영 공지 카피 다듬기',
    projectName: '운영 공지',
    status: 'planning',
    lastActivity: '방금',
    lastActivityAt: '2026-06-08T01:18:00.000Z',
    toolSummary: 'Gemini 1.5 Pro · 기본',
    savingsRate: 27,
    panelSlot: null,
  },
  {
    taskId: 'task-001',
    title: '신규 파트너 제안서 초안',
    projectName: '사업계획서',
    status: 'in_progress',
    lastActivity: '5분 전',
    lastActivityAt: '2026-06-08T01:13:00.000Z',
    toolSummary: 'Claude Sonnet · 품질 우선',
    savingsRate: 34,
    panelSlot: 'north-west',
  },
  {
    taskId: 'task-002',
    title: '40페이지 리서치 요약',
    projectName: '제품 리서치',
    status: 'ai_review',
    lastActivity: '12분 전',
    lastActivityAt: '2026-06-08T01:06:00.000Z',
    toolSummary: 'GPT-4.1 · 긴 컨텍스트',
    savingsRate: 41,
    panelSlot: 'north-east',
  },
];

function createPreviewPanels(): WorkbenchPanel[] {
  return [
    {
      slot: 'north-west',
      taskId: 'task-001',
      title: '신규 파트너 제안서 초안',
      status: 'in_progress',
      note: '좌측 인박스에서 이어온 작업',
    },
    {
      slot: 'north-east',
      taskId: 'task-002',
      title: '40페이지 리서치 요약',
      status: 'ai_review',
      note: '리서치 요약 패널',
    },
    {
      slot: 'south-west',
      taskId: null,
      title: '새 작업을 열어보세요',
      status: 'idle',
      note: '작업을 끌어오거나 새 채팅을 시작하세요',
    },
    {
      slot: 'south-east',
      taskId: null,
      title: '새 작업을 열어보세요',
      status: 'idle',
      note: '현재 비어 있는 독립 채팅 슬롯',
    },
  ];
}

function createPreviewRecentTasks(): WorkbenchRecentTask[] {
  return previewTaskSeeds.map((task) => ({
    ...task,
    isOpen: task.panelSlot !== null,
  }));
}

export const workbenchSurfaceCopy = {
  headline: '같은 작업을 그대로 이어 붙이는 멀티채팅 작업대',
  intro:
    '최근 작업 레일에서 방금 보던 task를 고르고, 오른쪽 패널에서 같은 대화를 이어가세요. 새 대화를 복제하지 않고 기존 작업을 재사용합니다.',
  railTitle: '최근 이어보기',
  railDescription: '최근 활동 순으로 정렬된 task를 골라 오른쪽 패널에 배치하거나, 이미 열려 있다면 그 위치로 바로 이동합니다.',
  railLoadingTitle: '최근 작업을 정리하고 있습니다',
  railLoadingBody: '작업대 레일과 패널 상태를 같은 source of truth에서 다시 불러오는 중입니다.',
  railErrorTitle: '작업대를 불러오지 못했습니다',
  railErrorBody: '채팅에서 다시 이어 열거나 잠시 후 작업대를 새로 열어 보세요.',
  stageTitle: '활성 패널',
  stageDescription:
    '왼쪽 레일은 어떤 task를 다룰지 고르는 곳이고, 오른쪽 패널은 실제 대화와 상태를 이어가는 작업 공간입니다.',
};

export const previewWorkbenchLayout: WorkbenchLayoutResult = {
  layoutId: 'layout-preview',
  updatedAt: '2026-06-08T01:18:00.000Z',
  activePanelSlot: 'north-west',
  recentTasks: createPreviewRecentTasks(),
  panels: createPreviewPanels(),
};

export function getWorkbenchSurfaceState(options: {
  desktopAvailable: boolean;
  queryStatus: WorkbenchRouteQueryStatus;
  layout: WorkbenchLayoutResult | null;
  previewLayout: WorkbenchLayoutResult;
  activePanelSlot: PanelSlot | null;
}) {
  const showLoadingState = options.desktopAvailable && options.queryStatus === 'loading' && !options.layout;
  const showErrorState = options.desktopAvailable && options.queryStatus === 'error' && !options.layout;
  const resolvedLayout = options.desktopAvailable ? options.layout : options.previewLayout;
  const recentTasks = resolvedLayout?.recentTasks ?? [];
  const panels = resolvedLayout?.panels ?? [];
  const showInteractiveContent = resolvedLayout !== null && !showLoadingState && !showErrorState;
  const resolvedActivePanelSlot = showInteractiveContent
    ? options.activePanelSlot ?? resolvedLayout?.activePanelSlot ?? null
    : null;
  const activeTaskId = panels.find((panel) => panel.slot === resolvedActivePanelSlot)?.taskId ?? null;

  return {
    layout: resolvedLayout,
    recentTasks,
    panels,
    activePanelSlot: resolvedActivePanelSlot,
    activeTaskId,
    showLoadingState,
    showErrorState,
    showInteractiveContent,
    railCountLabel: showLoadingState
      ? '동기화 중'
      : showErrorState
        ? '불러오지 못함'
        : `${recentTasks.length}개 task`,
    stageBadgeLabel: showLoadingState
      ? '동기화 대기'
      : showErrorState
        ? '다시 시도 필요'
        : activeTaskId
          ? '같은 task 이어서 작업 중'
          : '선택 대기',
  };
}

export function getWorkbenchStatusLabel(status: TaskStatus | 'idle') {
  switch (status) {
    case 'planning':
      return '기획';
    case 'in_progress':
      return '진행 중';
    case 'ai_review':
      return 'AI 검토';
    case 'human_review':
      return '사람 검토';
    case 'completed':
      return '완료';
    case 'idle':
      return '빈 패널';
  }
}

export function placeWorkbenchTaskInPreview(
  layout: WorkbenchLayoutResult,
  taskId: string,
): WorkbenchLayoutResult {
  const task = layout.recentTasks.find((item) => item.taskId === taskId);
  const nextActivityAt = '2026-06-08T01:19:00.000Z';

  if (!task) {
    return layout;
  }

  const panelSlot = resolveWorkbenchPanelSlot({
    panels: layout.panels,
    taskId,
  });

  return {
    ...layout,
    updatedAt: nextActivityAt,
    activePanelSlot: panelSlot,
    recentTasks: layout.recentTasks
      .map((item) =>
        item.taskId === taskId
          ? {
              ...item,
              isOpen: true,
              panelSlot,
              lastActivity: '방금',
              lastActivityAt: nextActivityAt,
            }
          : item,
      )
      .sort((left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt) || right.taskId.localeCompare(left.taskId),
      ),
    panels: layout.panels.map((panel) =>
      panel.slot === panelSlot
        ? {
            slot: panel.slot,
            taskId: task.taskId,
            title: task.title,
            status: task.status,
            note: `${task.projectName} · ${task.toolSummary}`,
          }
        : panel,
    ),
  };
}
