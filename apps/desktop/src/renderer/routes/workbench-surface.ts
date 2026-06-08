import type {
  ChatFeedMessage,
  ChatFeedRunSummary,
  PanelSlot,
  TaskStatus,
  WorkbenchLayoutResult,
  WorkbenchPanel,
  WorkbenchPanelConversation,
  WorkbenchRecentTask,
} from '../../shared/ipc/contracts.ts';
import { resolveWorkbenchPanelSlot } from '../../shared/ipc/workbench.ts';

export type WorkbenchRouteQueryStatus = 'idle' | 'loading' | 'success' | 'error';

export type WorkbenchPanelSubmitState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message: string | null;
};

export type WorkbenchPanelComposerState = {
  draft: string;
  pendingSubmission: ChatFeedMessage | null;
  submitState: WorkbenchPanelSubmitState;
};

export type WorkbenchComposerState = Record<PanelSlot, WorkbenchPanelComposerState>;

export type WorkbenchComposerAction =
  | {
      type: 'draft_changed';
      slot: PanelSlot;
      draft: string;
    }
  | {
      type: 'submit_started';
      slot: PanelSlot;
    }
  | {
      type: 'submit_succeeded';
      slot: PanelSlot;
      pendingSubmission: ChatFeedMessage;
    }
  | {
      type: 'submit_failed';
      slot: PanelSlot;
      message: string;
    }
  | {
      type: 'pending_submission_committed';
      slot: PanelSlot;
    };

type WorkbenchPanelActivityItem = {
  id: string;
  label: string;
  detail: string;
  tone: 'neutral' | 'progress' | 'success' | 'error';
};

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

export const workbenchSlotLabels: Record<PanelSlot, string> = {
  'north-west': '패널 A',
  'north-east': '패널 B',
  'south-west': '패널 C',
  'south-east': '패널 D',
};

export const workbenchSurfaceCopy = {
  headline: '같은 작업을 그대로 이어 붙이는 멀티채팅 작업대',
  intro:
    '최근 작업 레일에서 방금 보던 작업을 고르고, 오른쪽 패널에서 같은 대화를 이어가세요. 새 대화를 복제하지 않고 기존 흐름을 그대로 재사용합니다.',
  railTitle: '최근 이어보기',
  railDescription:
    '최근 활동 순으로 정렬된 작업을 골라 오른쪽 패널에 배치하거나, 이미 열려 있다면 그 위치로 바로 이동합니다.',
  railLoadingTitle: '최근 작업을 정리하고 있습니다',
  railLoadingBody: '작업대 레일과 패널 상태를 한곳에 저장된 최신 기준으로 다시 불러오는 중입니다.',
  railSyncWarningTitle: '마지막으로 동기화된 작업대를 보여주고 있습니다',
  railSyncWarningBody:
    '최근 재조회가 실패해 마지막으로 확인된 레일과 패널을 유지했습니다. 같은 작업은 계속 볼 수 있지만, 최신 상태를 다시 확인해 주세요.',
  railSyncWarningAction: '작업대 다시 동기화',
  railErrorTitle: '작업대를 불러오지 못했습니다',
  railErrorBody: '채팅에서 다시 이어 열거나 잠시 후 작업대를 새로 열어 보세요.',
  railEmptyTitle: '아직 열린 작업이 없습니다',
  railEmptyBody: '먼저 채팅에서 작업을 만들거나 아래 빈 패널에서 새 대화를 시작해 보세요.',
  stageTitle: '활성 패널',
  stageDescription:
    '왼쪽 레일은 어떤 작업을 이어갈지 고르는 곳이고, 오른쪽 패널은 실제 대화와 상태를 이어가는 작업 공간입니다.',
  panelInputPlaceholder:
    '같은 작업에 이어 붙일 추가 한국어 지시를 입력하세요. 원문은 이 작업 대화 기록에 그대로 남습니다.',
  panelSubmitSavingMessage: '같은 작업에 추가 지시를 저장하고 있습니다.',
  panelSubmitSavedMessage: '같은 작업에 추가 지시가 저장되었습니다.',
  panelSubmitErrorMessage:
    '추가 지시를 저장하지 못했습니다. 작성 중이던 한국어 초안은 그대로 남아 있습니다.',
  panelActivityTitle: '최근 활동',
  panelComposerTitle: '추가 지시',
  panelComposerBody: '이 패널 안에서 같은 작업과 대화 흐름을 그대로 이어갑니다.',
  panelSubmitAction: '같은 작업 이어서 보내기',
} as const;

function createIdleWorkbenchPanelSubmitState(): WorkbenchPanelSubmitState {
  return {
    status: 'idle',
    message: null,
  };
}

function createEmptyWorkbenchPanelComposerState(): WorkbenchPanelComposerState {
  return {
    draft: '',
    pendingSubmission: null,
    submitState: createIdleWorkbenchPanelSubmitState(),
  };
}

export function createWorkbenchComposerState(): WorkbenchComposerState {
  return {
    'north-west': createEmptyWorkbenchPanelComposerState(),
    'north-east': createEmptyWorkbenchPanelComposerState(),
    'south-west': createEmptyWorkbenchPanelComposerState(),
    'south-east': createEmptyWorkbenchPanelComposerState(),
  };
}

export function workbenchComposerReducer(
  state: WorkbenchComposerState,
  action: WorkbenchComposerAction,
): WorkbenchComposerState {
  const current = state[action.slot];

  switch (action.type) {
    case 'draft_changed':
      return {
        ...state,
        [action.slot]: {
          ...current,
          draft: action.draft,
          submitState:
            current.submitState.status === 'idle'
              ? current.submitState
              : createIdleWorkbenchPanelSubmitState(),
        },
      };
    case 'submit_started':
      return {
        ...state,
        [action.slot]: {
          ...current,
          submitState: {
            status: 'submitting',
            message: workbenchSurfaceCopy.panelSubmitSavingMessage,
          },
        },
      };
    case 'submit_succeeded':
      return {
        ...state,
        [action.slot]: {
          draft: '',
          pendingSubmission: action.pendingSubmission,
          submitState: {
            status: 'success',
            message: workbenchSurfaceCopy.panelSubmitSavedMessage,
          },
        },
      };
    case 'submit_failed':
      return {
        ...state,
        [action.slot]: {
          ...current,
          submitState: {
            status: 'error',
            message: action.message,
          },
        },
      };
    case 'pending_submission_committed':
      return {
        ...state,
        [action.slot]: {
          ...current,
          pendingSubmission: null,
        },
      };
  }
}

function createPreviewConversation(taskId: string): WorkbenchPanelConversation | null {
  if (taskId === 'task-001') {
    const messages: ChatFeedMessage[] = [
      {
        messageId: 'preview-message-101',
        conversationId: 'preview-conversation-001',
        runId: 'preview-run-101',
        role: 'user',
        contentKo: '신규 파트너 제안서 초안을 한국어로 구조화해줘.',
        createdAt: '2026-06-08T01:02:00.000Z',
      },
      {
        messageId: 'preview-message-102',
        conversationId: 'preview-conversation-001',
        runId: 'preview-run-101',
        role: 'assistant',
        contentKo: '시장 배경, 수익 모델, 제안 구조, 리스크 대응까지 네 블록으로 초안을 정리했습니다.',
        createdAt: '2026-06-08T01:04:00.000Z',
      },
      {
        messageId: 'preview-message-103',
        conversationId: 'preview-conversation-001',
        runId: 'preview-run-102',
        role: 'user',
        contentKo: '2번 섹션을 파트너 수익 배분 기준 중심으로 더 구체화해줘.',
        createdAt: '2026-06-08T01:12:00.000Z',
      },
    ];
    const runs: ChatFeedRunSummary[] = [
      {
        runId: 'preview-run-101',
        sourceMessageId: 'preview-message-101',
        status: 'completed',
        stage: 'completed',
        model: 'claude-sonnet-4',
        mode: 'quality',
        errorCode: null,
        failure: null,
        usage: {
          baselineInputTokens: 1280,
          optimizedInputTokens: 846,
          outputTokens: 931,
          latencyMs: 6200,
          savingsRate: 34,
          isEstimated: false,
        },
      },
      {
        runId: 'preview-run-102',
        sourceMessageId: 'preview-message-103',
        status: 'cloud_pending',
        stage: 'cloud_pending',
        model: 'claude-sonnet-4',
        mode: 'quality',
        errorCode: null,
        failure: null,
        usage: null,
      },
    ];

    return {
      conversationId: 'preview-conversation-001',
      messages,
      runs,
      activeRun: runs[runs.length - 1] ?? null,
    };
  }

  if (taskId === 'task-002') {
    const messages: ChatFeedMessage[] = [
      {
        messageId: 'preview-message-201',
        conversationId: 'preview-conversation-002',
        runId: 'preview-run-201',
        role: 'user',
        contentKo: '40페이지 리서치를 핵심 숫자와 리스크 중심으로 7개 항목만 남겨 요약해줘.',
        createdAt: '2026-06-08T00:54:00.000Z',
      },
      {
        messageId: 'preview-message-202',
        conversationId: 'preview-conversation-002',
        runId: 'preview-run-201',
        role: 'assistant',
        contentKo: 'TAM, CAC, 전환율, 경쟁사 비교, 규제 리스크를 포함한 7개 핵심 항목으로 압축했습니다.',
        createdAt: '2026-06-08T00:58:00.000Z',
      },
    ];
    const runs: ChatFeedRunSummary[] = [
      {
        runId: 'preview-run-201',
        sourceMessageId: 'preview-message-201',
        status: 'completed',
        stage: 'completed',
        model: 'gpt-4.1',
        mode: 'long_context',
        errorCode: null,
        failure: null,
        usage: {
          baselineInputTokens: 1924,
          optimizedInputTokens: 1135,
          outputTokens: 742,
          latencyMs: 8400,
          savingsRate: 41,
          isEstimated: false,
        },
      },
    ];

    return {
      conversationId: 'preview-conversation-002',
      messages,
      runs,
      activeRun: runs[runs.length - 1] ?? null,
    };
  }

  return null;
}

function createPreviewPanelForTask(taskId: string): WorkbenchPanel {
  const task = previewTaskSeeds.find((item) => item.taskId === taskId);

  if (!task || task.panelSlot === null) {
    return createPreviewEmptyPanel('south-west');
  }

  return {
    slot: task.panelSlot,
    taskId: task.taskId,
    title: task.title,
    status: task.status,
    note: `${task.projectName} · ${task.toolSummary}`,
    conversation: createPreviewConversation(task.taskId),
  };
}

function createPreviewPanels(): WorkbenchPanel[] {
  return [
    createPreviewPanelForTask('task-001'),
    createPreviewPanelForTask('task-002'),
    createPreviewEmptyPanel('south-west'),
    createPreviewEmptyPanel('south-east'),
  ];
}

function createPreviewRecentTasks(): WorkbenchRecentTask[] {
  return previewTaskSeeds.map((task) => ({
    ...task,
    isOpen: task.panelSlot !== null,
  }));
}

function createPreviewEmptyPanel(slot: PanelSlot): WorkbenchPanel {
  const titleBySlot: Record<PanelSlot, string> = {
    'north-west': '작업을 끌어오세요',
    'north-east': '새 채팅을 열어보세요',
    'south-west': '다른 작업을 병렬로 두세요',
    'south-east': '빈 슬롯을 유지해도 됩니다',
  };
  const noteBySlot: Record<PanelSlot, string> = {
    'north-west': '최근 작업 레일에서 원하는 작업을 선택해 독립 패널로 여세요',
    'north-east': '새 채팅이나 최근 작업을 이 슬롯에 배치할 수 있습니다',
    'south-west': '리서치, 초안, 검토 작업을 서로 다른 패널로 분리하세요',
    'south-east': '필요할 때 바로 이어 붙일 수 있도록 비워 둔 작업 공간입니다',
  };

  return {
    slot,
    taskId: null,
    title: titleBySlot[slot],
    status: 'idle',
    note: noteBySlot[slot],
    conversation: null,
  };
}

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
  const showSyncWarningState = options.desktopAvailable && options.queryStatus === 'error' && !!options.layout;
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
    showSyncWarningState,
    showInteractiveContent,
    railCountLabel: showLoadingState
      ? '동기화 중'
        : showErrorState
          ? '불러오지 못함'
        : showSyncWarningState
          ? '최근 값 유지 중'
        : `${recentTasks.length}개 작업`,
    stageBadgeLabel: showLoadingState
      ? '동기화 대기'
      : showErrorState
        ? '다시 시도 필요'
        : showSyncWarningState
          ? '재동기화 필요'
        : activeTaskId
          ? '같은 작업 이어서 진행 중'
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

export function getLatestWorkbenchPanelRun(panel: WorkbenchPanel) {
  return panel.conversation?.activeRun ?? panel.conversation?.runs[panel.conversation.runs.length - 1] ?? null;
}

export function hasInFlightWorkbenchRun(run: ChatFeedRunSummary | null) {
  return (
    run !== null &&
    run.status !== 'completed' &&
    run.status !== 'failed'
  );
}

function summarizeMessage(contentKo: string) {
  const collapsed = contentKo.replace(/\s+/g, ' ').trim();

  if (collapsed.length <= 56) {
    return collapsed;
  }

  return `${collapsed.slice(0, 56).trimEnd()}...`;
}

function getRunStatusLabel(run: ChatFeedRunSummary) {
  switch (run.status) {
    case 'queued':
      return '실행 대기';
    case 'optimizing':
      return '로컬 최적화 중';
    case 'optimized':
      return '영문 프롬프트 준비';
    case 'cloud_pending':
      return '모델 응답 대기';
    case 'restoring':
      return '한국어 복원 중';
    case 'completed':
      return '응답 저장 완료';
    case 'failed':
      return '실행 실패';
  }
}

export function getWorkbenchPanelActivityItems(panel: WorkbenchPanel): WorkbenchPanelActivityItem[] {
  if (!panel.conversation) {
    return [];
  }

  const latestRun = getLatestWorkbenchPanelRun(panel);
  const latestUserMessage =
    [...panel.conversation.messages].reverse().find((message) => message.role === 'user') ?? null;
  const latestAssistantMessage =
    [...panel.conversation.messages].reverse().find((message) => message.role === 'assistant') ?? null;
  const items: WorkbenchPanelActivityItem[] = [];

  if (latestRun) {
    items.push({
      id: `run-${latestRun.runId}`,
      label: getRunStatusLabel(latestRun),
      detail:
        latestRun.status === 'failed'
          ? latestRun.failure?.message ?? '같은 작업의 최근 실행이 안전하게 멈췄습니다.'
          : latestRun.usage
            ? `${latestRun.usage.savingsRate}% 절감 · ${latestRun.usage.latencyMs}ms`
            : '같은 작업에서 최신 실행이 진행 중입니다.',
      tone:
        latestRun.status === 'failed'
          ? 'error'
          : latestRun.status === 'completed'
            ? 'success'
            : 'progress',
    });
  }

  if (latestUserMessage) {
    items.push({
      id: `user-${latestUserMessage.messageId}`,
      label: '최근 추가 지시',
      detail: summarizeMessage(latestUserMessage.contentKo),
      tone: 'neutral',
    });
  }

  if (latestAssistantMessage) {
    items.push({
      id: `assistant-${latestAssistantMessage.messageId}`,
      label: '최근 한국어 응답',
      detail: summarizeMessage(latestAssistantMessage.contentKo),
      tone: 'neutral',
    });
  }

  return items;
}

export function mergeWorkbenchPanelMessages(
  persistedMessages: ChatFeedMessage[],
  pendingSubmission: ChatFeedMessage | null,
) {
  if (!pendingSubmission) {
    return persistedMessages;
  }

  if (persistedMessages.some((message) => message.messageId === pendingSubmission.messageId)) {
    return persistedMessages;
  }

  return [...persistedMessages, pendingSubmission];
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
            conversation: createPreviewConversation(task.taskId),
          }
        : panel,
    ),
  };
}

export function moveWorkbenchPanelInPreview(
  layout: WorkbenchLayoutResult,
  fromPanelSlot: PanelSlot,
  toPanelSlot: PanelSlot,
): WorkbenchLayoutResult {
  if (fromPanelSlot === toPanelSlot) {
    return layout;
  }

  const sourcePanel = layout.panels.find((panel) => panel.slot === fromPanelSlot);
  const targetPanel = layout.panels.find((panel) => panel.slot === toPanelSlot);

  if (!sourcePanel?.taskId || !targetPanel) {
    return layout;
  }

  const sourceTask = layout.recentTasks.find((task) => task.taskId === sourcePanel.taskId) ?? null;
  const targetTask = targetPanel.taskId
    ? layout.recentTasks.find((task) => task.taskId === targetPanel.taskId) ?? null
    : null;

  return {
    ...layout,
    updatedAt: '2026-06-08T01:20:00.000Z',
    activePanelSlot: toPanelSlot,
    recentTasks: layout.recentTasks.map((task) => {
      if (task.taskId === sourcePanel.taskId) {
        return {
          ...task,
          panelSlot: toPanelSlot,
          isOpen: true,
        };
      }

      if (targetTask && task.taskId === targetTask.taskId) {
        return {
          ...task,
          panelSlot: fromPanelSlot,
          isOpen: true,
        };
      }

      return task;
    }),
    panels: layout.panels.map((panel) => {
      if (panel.slot === fromPanelSlot) {
        if (!targetTask) {
          return createPreviewEmptyPanel(fromPanelSlot);
        }

        return {
          slot: fromPanelSlot,
          taskId: targetTask.taskId,
          title: targetTask.title,
          status: targetTask.status,
          note: `${targetTask.projectName} · ${targetTask.toolSummary}`,
          conversation: createPreviewConversation(targetTask.taskId),
        };
      }

      if (panel.slot === toPanelSlot && sourceTask) {
        return {
          slot: toPanelSlot,
          taskId: sourceTask.taskId,
          title: sourceTask.title,
          status: sourceTask.status,
          note: `${sourceTask.projectName} · ${sourceTask.toolSummary}`,
          conversation: createPreviewConversation(sourceTask.taskId),
        };
      }

      return panel;
    }),
  };
}

export function closeWorkbenchPanelInPreview(
  layout: WorkbenchLayoutResult,
  panelSlot: PanelSlot,
): WorkbenchLayoutResult {
  const targetPanel = layout.panels.find((panel) => panel.slot === panelSlot);

  if (!targetPanel?.taskId) {
    return layout;
  }

  const remainingOpenPanel = layout.panels.find(
    (panel) => panel.slot !== panelSlot && panel.taskId !== null,
  );

  return {
    ...layout,
    updatedAt: '2026-06-08T01:21:00.000Z',
    activePanelSlot: remainingOpenPanel?.slot ?? null,
    recentTasks: layout.recentTasks.map((task) =>
      task.taskId === targetPanel.taskId
        ? {
            ...task,
            panelSlot: null,
            isOpen: false,
          }
        : task,
    ),
    panels: layout.panels.map((panel) =>
      panel.slot === panelSlot ? createPreviewEmptyPanel(panelSlot) : panel,
    ),
  };
}
