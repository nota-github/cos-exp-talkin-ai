import {
  commandNames,
  ipcChannels,
  queryNames,
  type AppSettings,
  type BoardColumnsResult,
  type ChatFeedMessage,
  type ChatFeedRunSummary,
  type CreateProjectResult,
  type DesktopCommandName,
  type DesktopCommandRequest,
  type DesktopCommandResponse,
  type DesktopInvalidationEvent,
  type DesktopQueryName,
  type DesktopQueryRequest,
  type DesktopQueryResponse,
  type HistoryEntryResult,
  type HistoryFeedResult,
  type InvalidationTarget,
  type PanelSlot,
  type ProjectDetailResult,
  type ProjectListResult,
  type ProjectTaskSummary,
  type SetTaskProjectResult,
  type TaskStatus,
  type UpdateProjectResult,
  type UsageDashboardResult,
  type WorkbenchPanel,
  type WorkbenchLayoutResult,
} from '../../shared/ipc/contracts';
import {
  resolveWorkbenchPanelSlot,
  workbenchPanelSlots,
} from '../../shared/ipc/workbench.ts';
import type { BoardService } from '../board/index.ts';
import type { ChatHistoryService } from '../chat/index.ts';
import type { HistoryInspectionService } from '../history/index.ts';
import type { ProjectService } from '../projects/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
  type AppSettingsService,
} from '../settings/index.ts';
import type { TranslationMcpAdapter } from '../translation/index.ts';
import type { UsageDashboardService } from '../usage/index.ts';
import type { WorkbenchService } from '../workbench/index.ts';

type InternalTaskRecord = {
  taskId: string;
  conversationId: string;
  title: string;
  preview: string;
  projectId: string | null;
  projectName: string;
  sourceScreen: 'chat' | 'workbench' | 'projects' | 'kanban';
  status: TaskStatus;
  model: AppSettings['defaultModel'];
  mode: AppSettings['optimizationMode'];
  savingsRate: number;
  lastActivity: string;
  lastActivityAt: string;
  toolSummary: string;
};

type InternalWorkbenchLayout = {
  layoutId: string;
  updatedAt: string;
  activePanelSlot: PanelSlot | null;
  panels: WorkbenchPanel[];
};

type InternalProjectRecord = {
  projectId: string;
  name: string;
  description: string;
  goal: string;
  updatedAt: string;
  files: string[];
};

type DesktopIpcState = {
  chatFeed: DesktopQueryResponse<'getChatFeed'>;
  workbenchLayout: InternalWorkbenchLayout;
  boardColumns: BoardColumnsResult;
  projects: Record<string, InternalProjectRecord>;
  usageDashboards: Record<'month' | 'all_time', UsageDashboardResult>;
  historyEntries: Record<string, HistoryEntryResult>;
  tasks: Record<string, InternalTaskRecord>;
  nextIds: {
    task: number;
    conversation: number;
    message: number;
    run: number;
    event: number;
  };
};

type CommandHandlerMap = {
  [TName in DesktopCommandName]: (
    request: DesktopCommandRequest<TName>,
  ) => Promise<DesktopCommandResponse<TName>>;
};

type QueryHandlerMap = {
  [TName in DesktopQueryName]: (
    request: DesktopQueryRequest<TName>,
  ) => Promise<DesktopQueryResponse<TName>>;
};

export type DesktopIpcMainLike = {
  handle: (
    channel: string,
    listener: (_event: unknown, request: unknown) => Promise<unknown> | unknown,
  ) => void;
};

export type DesktopIpcBroadcaster = (channel: string, payload: unknown) => void;

export type RegisterDesktopIpcOptions = {
  broadcast?: DesktopIpcBroadcaster;
  boardService?: BoardService;
  chatHistoryService?: ChatHistoryService;
  commitMutation?: (
    commandName: DesktopCommandName,
    nextState: DesktopIpcState,
  ) => Promise<void> | void;
  state?: DesktopIpcState;
  historyInspectionService?: HistoryInspectionService;
  projectService?: ProjectService;
  settingsService?: AppSettingsService;
  translationAdapter?: TranslationMcpAdapter;
  usageDashboardService?: UsageDashboardService;
  workbenchService?: WorkbenchService;
};

export type DesktopIpcService = {
  commands: CommandHandlerMap;
  queries: QueryHandlerMap;
  translationAdapter: TranslationMcpAdapter | null;
};

type PreparedMutationResult<TResult> =
  | {
      result: TResult;
      targets: InvalidationTarget[];
      commit?: undefined;
    }
  | {
      commit: () => Promise<TResult> | TResult;
      targets: InvalidationTarget[];
      result?: undefined;
    };

const boardColumnTitles: Record<TaskStatus, string> = {
  planning: '기획',
  in_progress: '진행 중',
  ai_review: 'AI 검토',
  human_review: '사람 검토',
  completed: '완료',
};

const panelSlots: PanelSlot[] = [...workbenchPanelSlots];

const usageDashboardCategoryLabels = {
  general: '일반 요청',
  starter_template: '추천 시작 작업',
  project_linked: '프로젝트 연결',
} as const;

const activityNowLabel = '방금';

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function formatRelativeActivity(activityAt: string, requestedAt = nowIso()) {
  const diffMs = Math.max(0, new Date(requestedAt).getTime() - new Date(activityAt).getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return '방금';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 7) {
    return `${diffDays}일 전`;
  }

  const [year, month, day] = activityAt.slice(0, 10).split('-');
  return `${year}.${month}.${day}`;
}

function getEffectiveProjectActivityAt(updatedAt: string, lastTaskActivityAt: string | null) {
  if (!lastTaskActivityAt) {
    return updatedAt;
  }

  return updatedAt > lastTaskActivityAt ? updatedAt : lastTaskActivityAt;
}

function markTaskActivity(task: InternalTaskRecord, activityAt = nowIso()) {
  task.lastActivity = activityNowLabel;
  task.lastActivityAt = activityAt;
}

function computeDashboardCostUsd(inputTokens: number) {
  return Number(((inputTokens / 1_000) * 0.0024).toFixed(6));
}

function createUsageDashboardCategorySeed(
  id: keyof typeof usageDashboardCategoryLabels,
  requestCount: number,
  baselineTokens: number,
  optimizedTokens: number,
) {
  return {
    id,
    label: usageDashboardCategoryLabels[id],
    requestCount,
    baselineTokens,
    optimizedTokens,
    tokenReduction: Math.max(0, baselineTokens - optimizedTokens),
    savingsRate:
      baselineTokens <= 0
        ? 0
        : Math.max(0, Math.round((1 - optimizedTokens / baselineTokens) * 100)),
    share: 0,
  };
}

function buildUsageDashboardState(
  range: 'month' | 'all_time',
  categorySeeds: Array<ReturnType<typeof createUsageDashboardCategorySeed>>,
): UsageDashboardResult {
  const baselineTokens = categorySeeds.reduce((sum, category) => sum + category.baselineTokens, 0);
  const optimizedTokens = categorySeeds.reduce((sum, category) => sum + category.optimizedTokens, 0);
  const requestCount = categorySeeds.reduce((sum, category) => sum + category.requestCount, 0);
  const tokenReduction = Math.max(0, baselineTokens - optimizedTokens);
  const withoutCostUsd = computeDashboardCostUsd(baselineTokens);
  const withCostUsd = computeDashboardCostUsd(optimizedTokens);

  return {
    range,
    pricingBasis: {
      status: 'single',
      activeBasis: {
        provider: 'openai',
        model: 'gpt-4.1',
        pricingVersion: 'openai-gpt-4.1-2026-06',
        requestCount,
      },
      bases: [
        {
          provider: 'openai',
          model: 'gpt-4.1',
          pricingVersion: 'openai-gpt-4.1-2026-06',
          requestCount,
        },
      ],
    },
    categoryShareBasis: 'baseline_tokens',
    totals: {
      requestCount,
      baselineTokens,
      optimizedTokens,
      tokenReduction,
      savingsRate:
        baselineTokens <= 0
          ? 0
          : Math.max(0, Math.round((1 - optimizedTokens / baselineTokens) * 100)),
      estimatedSavingsUsd: Number((withoutCostUsd - withCostUsd).toFixed(6)),
    },
    comparison: {
      withoutOptimization: {
        requestCount,
        inputTokens: baselineTokens,
        estimatedCostUsd: withoutCostUsd,
      },
      withOptimization: {
        requestCount,
        inputTokens: optimizedTokens,
        estimatedCostUsd: withCostUsd,
      },
    },
    categories: categorySeeds.map((category) => ({
      ...category,
      share:
        baselineTokens > 0
          ? Math.round((category.baselineTokens / baselineTokens) * 100)
          : 0,
    })),
  };
}

function applyUsageDashboardDelta(
  dashboard: UsageDashboardResult,
  categoryId: keyof typeof usageDashboardCategoryLabels,
  baselineDelta: number,
  optimizedDelta: number,
) {
  const nextSeeds = dashboard.categories.map((category) =>
    category.id === categoryId
      ? createUsageDashboardCategorySeed(
          category.id,
          category.requestCount + 1,
          category.baselineTokens + baselineDelta,
          category.optimizedTokens + optimizedDelta,
        )
      : createUsageDashboardCategorySeed(
          category.id,
          category.requestCount,
          category.baselineTokens,
          category.optimizedTokens,
        ),
  );
  const nextDashboard = buildUsageDashboardState(dashboard.range, nextSeeds);

  dashboard.totals = nextDashboard.totals;
  dashboard.comparison = nextDashboard.comparison;
  dashboard.categories = nextDashboard.categories;
}

function createInitialState(): DesktopIpcState {
  const primaryTaskActivityAt = '2026-06-08T01:13:00.000Z';
  const researchTaskActivityAt = '2026-06-08T01:06:00.000Z';
  const polishTaskActivityAt = '2026-06-08T01:18:00.000Z';

  const primaryTask: InternalTaskRecord = {
    taskId: 'task-001',
    conversationId: 'conv-001',
    title: '신규 파트너 제안서 초안',
    preview: '제품 개요와 시장 진입 전략이 보이는 목차부터 정리해줘.',
    projectId: 'project-001',
    projectName: '사업계획서',
    sourceScreen: 'chat',
    status: 'in_progress',
    model: 'claude-sonnet-4',
    mode: 'quality',
    savingsRate: 34,
    lastActivity: '5분 전',
    lastActivityAt: primaryTaskActivityAt,
    toolSummary: 'Claude Sonnet · 품질 우선',
  };

  const researchTask: InternalTaskRecord = {
    taskId: 'task-002',
    conversationId: 'conv-002',
    title: '40페이지 리서치 요약',
    preview: '긴 PDF 핵심만 7개 항목으로 묶어줘.',
    projectId: 'project-002',
    projectName: '제품 리서치',
    sourceScreen: 'chat',
    status: 'ai_review',
    model: 'gpt-4.1',
    mode: 'long_context',
    savingsRate: 41,
    lastActivity: '12분 전',
    lastActivityAt: researchTaskActivityAt,
    toolSummary: 'GPT-4.1 · 긴 컨텍스트',
  };

  const polishTask: InternalTaskRecord = {
    taskId: 'task-003',
    conversationId: 'conv-003',
    title: '운영 공지 카피 다듬기',
    preview: '톤은 부드럽게 유지하고 핵심 일정은 더 또렷하게.',
    projectId: 'project-003',
    projectName: '운영 공지',
    sourceScreen: 'chat',
    status: 'planning',
    model: 'gemini-1.5-pro',
    mode: 'balanced',
    savingsRate: 27,
    lastActivity: '방금',
    lastActivityAt: polishTaskActivityAt,
    toolSummary: 'Gemini 1.5 Pro · 기본',
  };

  const tasks = {
    [primaryTask.taskId]: primaryTask,
    [researchTask.taskId]: researchTask,
    [polishTask.taskId]: polishTask,
  };

  const state: DesktopIpcState = {
    chatFeed: {
      activeConversationId: primaryTask.conversationId,
      activeTaskId: primaryTask.taskId,
      activeTaskTitle: primaryTask.title,
      recommendedPrompts: [
        '사업계획서 초안을 한국어로 구조화해줘',
        '긴 PDF 핵심만 7개 항목으로 요약해줘',
        '브랜드 카피를 더 또렷한 문장으로 다듬어줘',
      ],
      items: [],
      messages: [
        {
          messageId: 'msg-001',
          conversationId: primaryTask.conversationId,
          runId: 'run-001',
          role: 'user',
          contentKo: '시장 진입 전략이 보이도록 사업계획서 초안을 목차 중심으로 정리해줘.',
          createdAt: '2026-06-08T01:10:00.000Z',
        },
      ],
      runs: [
        {
          runId: 'run-001',
          sourceMessageId: 'msg-001',
          status: 'queued',
          stage: 'queued',
          model: primaryTask.model,
          mode: primaryTask.mode,
          errorCode: null,
          failure: null,
          usage: null,
        },
      ],
      activeRun: {
        runId: 'run-001',
        sourceMessageId: 'msg-001',
        status: 'queued',
        stage: 'queued',
        model: primaryTask.model,
        mode: primaryTask.mode,
        errorCode: null,
        failure: null,
        usage: null,
      },
    },
    workbenchLayout: {
      layoutId: 'layout-primary',
      updatedAt: nowIso(),
      activePanelSlot: 'north-west',
      panels: panelSlots.map((slot, index) => ({
        slot,
        taskId: index === 0 ? primaryTask.taskId : index === 1 ? researchTask.taskId : null,
        title:
          index === 0
            ? primaryTask.title
            : index === 1
              ? researchTask.title
              : '새 작업을 열어보세요',
        status:
          index === 0
            ? primaryTask.status
            : index === 1
              ? researchTask.status
              : 'idle',
        note:
          index === 0
            ? '좌측 인박스에서 이어온 작업'
            : index === 1
              ? '리서치 요약 패널'
              : '작업을 끌어오거나 새 채팅을 시작하세요',
        conversation: null,
      })),
    },
    boardColumns: {
      columns: [],
    },
    projects: {
      'project-001': {
        projectId: 'project-001',
        name: '사업계획서',
        description: '국문 사업계획서와 파트너 제안 문서를 묶는 작업 공간',
        goal: '시장 진입 전략과 수익 모델을 한 흐름으로 정리',
        updatedAt: '2026-06-08T00:58:00.000Z',
        files: ['partner-brief.pdf', 'pricing-notes.docx'],
      },
      'project-002': {
        projectId: 'project-002',
        name: '제품 리서치',
        description: '장문 자료 요약과 비교 분석을 관리하는 프로젝트',
        goal: '핵심 경쟁사 포지셔닝을 1페이지 요약으로 축약',
        updatedAt: '2026-06-08T00:54:00.000Z',
        files: ['research-pack.pdf'],
      },
      'project-003': {
        projectId: 'project-003',
        name: '운영 공지',
        description: '사용자-facing 운영 메시지와 카피 수정',
        goal: '짧지만 오해 없는 공지 톤 정리',
        updatedAt: '2026-06-08T01:09:00.000Z',
        files: [],
      },
    },
    usageDashboards: {
      month: buildUsageDashboardState('month', [
        createUsageDashboardCategorySeed('starter_template', 4, 8110, 4310),
        createUsageDashboardCategorySeed('general', 3, 6020, 3890),
        createUsageDashboardCategorySeed('project_linked', 2, 4110, 2610),
      ]),
      all_time: buildUsageDashboardState('all_time', [
        createUsageDashboardCategorySeed('starter_template', 11, 21490, 12410),
        createUsageDashboardCategorySeed('general', 8, 17820, 10980),
        createUsageDashboardCategorySeed('project_linked', 6, 15000, 8750),
      ]),
    },
    historyEntries: {
      'run-001': {
        runId: 'run-001',
        taskId: primaryTask.taskId,
        title: primaryTask.title,
        model: primaryTask.model,
        mode: primaryTask.mode,
        completedAt: '2026-06-08T01:18:00.000Z',
        sourcePromptKo: {
          content: '시장 진입 전략이 보이도록 사업계획서 초안을 목차 중심으로 정리해줘.',
          tokenEstimate: 1240,
        },
        optimizedPromptEn: {
          content:
            'Draft a business plan outline focused on market entry strategy. Preserve headings and numbered sections.',
          tokenEstimate: 756,
        },
        providerResponseEn: {
          content:
            '1. Executive Summary\n2. Problem and Market Context\n3. Market Entry Strategy\n4. Revenue Model\n5. Rollout Milestones',
          tokenEstimate: 488,
        },
        finalResponseKo: {
          content:
            '시장 진입 전략을 먼저 보여주는 구조로 사업계획서 목차 초안을 정리했습니다.',
          tokenEstimate: 522,
        },
        usage: {
          baselineInputTokens: 1240,
          optimizedInputTokens: 756,
          outputTokens: 488,
          tokenReduction: 484,
          savingsRate: 39,
          estimatedSavingsUsd: 1.16,
          pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
          isEstimated: false,
        },
      },
    },
    tasks,
    nextIds: {
      task: 4,
      conversation: 4,
      message: 2,
      run: 2,
      event: 1,
    },
  };

  state.chatFeed.items = sortTasksForChatFeed(state.tasks);
  state.boardColumns = rebuildBoardColumns(state.tasks);

  return state;
}

function sortTasksForChatFeed(tasks: Record<string, InternalTaskRecord>) {
  return Object.values(tasks)
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt) || right.taskId.localeCompare(left.taskId),
    )
    .map((task) => ({
      taskId: task.taskId,
      conversationId: task.conversationId,
      title: task.title,
      preview: task.preview,
      status: task.status,
      model: task.model,
      mode: task.mode,
      savingsRate: task.savingsRate,
      updatedAt: task.lastActivityAt,
    }));
}

function buildWorkbenchLayoutFromState(state: DesktopIpcState): WorkbenchLayoutResult {
  const openTaskBySlot = new Map(
    state.workbenchLayout.panels
      .filter((panel) => panel.taskId !== null)
      .map((panel) => [panel.taskId as string, panel.slot]),
  );

  return {
    layoutId: state.workbenchLayout.layoutId,
    updatedAt: state.workbenchLayout.updatedAt,
    activePanelSlot: state.workbenchLayout.activePanelSlot,
    recentTasks: Object.values(state.tasks)
      .sort((left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt) || right.taskId.localeCompare(left.taskId),
      )
      .map((task) => {
        const panelSlot = openTaskBySlot.get(task.taskId) ?? null;

        return {
          taskId: task.taskId,
          title: task.title,
          projectName: task.projectName,
          status: task.status,
          lastActivity: task.lastActivity,
          lastActivityAt: task.lastActivityAt,
          toolSummary: task.toolSummary,
          savingsRate: task.savingsRate,
          panelSlot,
          isOpen: panelSlot !== null,
        };
      }),
    panels: clone(state.workbenchLayout.panels),
  };
}

function buildProjectTaskSummaries(
  state: DesktopIpcState,
  projectId: string,
): ProjectTaskSummary[] {
  return Object.values(state.tasks)
    .filter((task) => task.projectId === projectId)
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt) || right.taskId.localeCompare(left.taskId),
    )
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      lastActivity: task.lastActivity,
      lastActivityAt: task.lastActivityAt,
    }));
}

function buildProjectDetailFromState(
  state: DesktopIpcState,
  projectId: string,
): ProjectDetailResult {
  const project = ensureProject(state, projectId);

  return {
    projectId: project.projectId,
    name: project.name,
    description: project.description,
    goal: project.goal,
    updatedAt: project.updatedAt,
    files: [...project.files],
    tasks: buildProjectTaskSummaries(state, projectId),
  };
}

function buildProjectListFromState(state: DesktopIpcState): ProjectListResult {
  const projects = Object.values(state.projects)
    .map((project) => {
      const taskSummaries = buildProjectTaskSummaries(state, project.projectId);
      const lastActivityAt = getEffectiveProjectActivityAt(
        project.updatedAt,
        taskSummaries[0]?.lastActivityAt ?? null,
      );

      return {
        projectId: project.projectId,
        name: project.name,
        description: project.description,
        goal: project.goal,
        taskCount: taskSummaries.length,
        fileCount: project.files.length,
        updatedAt: project.updatedAt,
        lastActivityAt,
        lastActivity: formatRelativeActivity(lastActivityAt),
      };
    })
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt) ||
      right.updatedAt.localeCompare(left.updatedAt) ||
      right.projectId.localeCompare(left.projectId),
    );

  const recentTasks = Object.values(state.tasks)
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt) || right.taskId.localeCompare(left.taskId),
    )
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      projectName: task.projectId ? task.projectName : null,
      sourceScreen: task.sourceScreen,
      lastActivity: task.lastActivity,
      lastActivityAt: task.lastActivityAt,
    }));

  return {
    projects,
    recentTasks,
  };
}

function getInMemoryNextActiveWorkbenchSlot(panels: WorkbenchPanel[]): PanelSlot | null {
  return panels.find((panel) => panel.taskId !== null)?.slot ?? null;
}

function buildHistoryFeedFromState(state: DesktopIpcState): HistoryFeedResult {
  return {
    items: Object.values(state.historyEntries)
      .map((entry) => ({
        runId: entry.runId,
        taskId: entry.taskId,
        title: entry.title,
        finalResponsePreview:
          entry.finalResponseKo.content.replace(/\s+/g, ' ').trim() ||
          '최종 한국어 응답이 아직 저장되지 않았습니다.',
        model: entry.model,
        mode: entry.mode,
        completedAt: entry.completedAt,
        savingsRate: entry.usage.savingsRate,
        tokenReduction: entry.usage.tokenReduction,
      }))
      .sort((left, right) =>
        (right.completedAt ?? '').localeCompare(left.completedAt ?? ''),
      ),
  };
}

function stageSubmittedPromptInState(
  draftState: DesktopIpcState,
  request: DesktopCommandRequest<'submitPrompt'>,
  ids: {
    taskId: string;
    conversationId: string;
    messageId: string;
    runId: string;
  },
) {
  const projectId = request.projectId ?? null;
  const usageCategory = request.projectId ? 'project_linked' : 'general';
  const project = projectId ? ensureProject(draftState, projectId) : null;
  const title = request.promptKo.slice(0, 24) || '새 한국어 작업';
  const activityAt = nowIso();
  const tokenBaseline = Math.max(request.promptKo.length * 3, 280);
  const tokenOptimized = Math.max(Math.floor(tokenBaseline * 0.61), 170);
  const savingsRate = Math.round((1 - tokenOptimized / tokenBaseline) * 100);
  const nextMessage: ChatFeedMessage = {
    messageId: ids.messageId,
    conversationId: ids.conversationId,
    runId: ids.runId,
    role: 'user',
    contentKo: request.promptKo,
    createdAt: nowIso(),
  };
  const nextRun: ChatFeedRunSummary = {
    runId: ids.runId,
    sourceMessageId: ids.messageId,
    status: 'queued',
    stage: 'queued',
    model: request.selectedModel,
    mode: request.optimizationMode,
    errorCode: null,
    failure: null,
    usage: null,
  };

  draftState.tasks[ids.taskId] = {
    taskId: ids.taskId,
    conversationId: ids.conversationId,
    title,
    preview: request.promptKo,
    projectId,
    projectName: project?.name ?? '개인 작업',
    sourceScreen: 'chat',
    status: 'planning',
    model: request.selectedModel,
    mode: request.optimizationMode,
    savingsRate,
    lastActivity: activityNowLabel,
    lastActivityAt: activityAt,
    toolSummary: `${request.selectedModel} · ${request.optimizationMode}`,
  };

  draftState.chatFeed.activeConversationId = ids.conversationId;
  draftState.chatFeed.activeTaskId = ids.taskId;
  draftState.chatFeed.activeTaskTitle = title;
  draftState.chatFeed.items = sortTasksForChatFeed(draftState.tasks);
  draftState.chatFeed.messages = [nextMessage];
  draftState.chatFeed.runs = [nextRun];
  draftState.chatFeed.activeRun = nextRun;
  draftState.boardColumns = rebuildBoardColumns(draftState.tasks);

  draftState.historyEntries[ids.runId] = {
    runId: ids.runId,
    taskId: ids.taskId,
    title,
    model: request.selectedModel,
    mode: request.optimizationMode,
    completedAt: null,
    sourcePromptKo: {
      content: request.promptKo,
      tokenEstimate: tokenBaseline,
    },
    optimizedPromptEn: {
      content:
        'Condense the Korean task into an English prompt while preserving constraints, nouns, and output structure.',
      tokenEstimate: tokenOptimized,
    },
    providerResponseEn: null,
    finalResponseKo: {
      content: '이 작업은 로컬 최적화 이후 클라우드 추론을 기다리는 상태입니다.',
      tokenEstimate: null,
    },
    usage: {
      baselineInputTokens: tokenBaseline,
      optimizedInputTokens: tokenOptimized,
      outputTokens: 0,
      tokenReduction: Math.max(0, tokenBaseline - tokenOptimized),
      savingsRate,
      estimatedSavingsUsd: 0,
      pricingVersion: 'openai-gpt-4.1-2026-06',
      isEstimated: true,
    },
  };

  applyUsageDashboardDelta(
    draftState.usageDashboards.month,
    usageCategory,
    tokenBaseline,
    tokenOptimized,
  );
  applyUsageDashboardDelta(
    draftState.usageDashboards.all_time,
    usageCategory,
    tokenBaseline,
    tokenOptimized,
  );
}

function stageRetriedRunInState(
  draftState: DesktopIpcState,
  request: DesktopCommandRequest<'retryRun'>,
  result: DesktopCommandResponse<'retryRun'>,
) {
  const entry = ensureHistoryEntry(draftState, request.runId);
  const sourceMessage =
    draftState.chatFeed.messages.find((message) => message.messageId === draftState.chatFeed.activeRun?.sourceMessageId) ??
    draftState.chatFeed.messages.find(
      (message) => message.runId === request.runId && message.role === 'user',
    ) ??
    draftState.chatFeed.messages.find((message) => message.role === 'user') ??
    null;
  const sourceMessageId = sourceMessage?.messageId ?? `msg-${String(draftState.nextIds.message).padStart(3, '0')}`;
  const model = draftState.chatFeed.activeRun?.model ?? entry.provider;
  const mode = draftState.chatFeed.activeRun?.mode ?? 'balanced';

  draftState.chatFeed.activeRun = {
    runId: result.runId,
    sourceMessageId,
    status: 'queued',
    stage: 'queued',
    model,
    mode,
    errorCode: null,
    failure: null,
    usage: null,
  };
  draftState.chatFeed.runs = [
    ...draftState.chatFeed.runs.filter((run) => run.runId !== result.runId),
    draftState.chatFeed.activeRun,
  ];

  draftState.historyEntries[result.runId] = {
    ...entry,
    runId: result.runId,
    completedAt: null,
    providerResponseEn: null,
    finalResponseKo: {
      content: '재시도 요청이 접수되었습니다. 이전 한국어 입력과 기존 응답은 그대로 유지됩니다.',
      tokenEstimate: null,
    },
  };
}

function stageCreatedProjectInState(
  draftState: DesktopIpcState,
  request: DesktopCommandRequest<'createProject'>,
  result: CreateProjectResult,
  updatedAt: string,
) {
  draftState.projects[result.projectId] = {
    projectId: result.projectId,
    name: request.name.trim(),
    description: request.description.trim(),
    goal: request.goal.trim(),
    updatedAt,
    files: [],
  };
}

function stageUpdatedProjectInState(
  draftState: DesktopIpcState,
  request: DesktopCommandRequest<'updateProject'>,
  result: UpdateProjectResult,
) {
  const project = ensureProject(draftState, request.projectId);
  const nextName = request.name.trim();

  project.name = nextName;
  project.description = request.description.trim();
  project.goal = request.goal.trim();
  project.updatedAt = result.updatedAt;

  for (const task of Object.values(draftState.tasks)) {
    if (task.projectId === request.projectId) {
      task.projectName = nextName;
    }
  }

  draftState.workbenchLayout.panels = draftState.workbenchLayout.panels.map((panel) => {
    if (!panel.taskId) {
      return panel;
    }

    const task = draftState.tasks[panel.taskId];

    if (!task || task.projectId !== request.projectId) {
      return panel;
    }

    return {
      ...panel,
      note: `최근 활동 ${task.lastActivity} · ${task.projectName}`,
    };
  });

  draftState.boardColumns = rebuildBoardColumns(draftState.tasks);
  draftState.chatFeed.items = sortTasksForChatFeed(draftState.tasks);
}

function stageSetTaskProjectInState(
  draftState: DesktopIpcState,
  result: SetTaskProjectResult,
  updatedAt: string,
) {
  const task = ensureTask(draftState, result.taskId);
  const previousProjectId = task.projectId;
  const nextProject = result.projectId ? ensureProject(draftState, result.projectId) : null;

  task.projectId = result.projectId;
  task.projectName = nextProject?.name ?? '개인 작업';
  markTaskActivity(task, updatedAt);

  if (previousProjectId) {
    const previousProject = ensureProject(draftState, previousProjectId);
    previousProject.updatedAt = updatedAt;
  }

  if (nextProject) {
    nextProject.updatedAt = updatedAt;
  }

  draftState.workbenchLayout.panels = draftState.workbenchLayout.panels.map((panel) =>
    panel.taskId === task.taskId
      ? {
          ...panel,
          note: `최근 활동 ${task.lastActivity} · ${task.projectName}`,
        }
      : panel,
  );

  draftState.boardColumns = rebuildBoardColumns(draftState.tasks);
  draftState.chatFeed.items = sortTasksForChatFeed(draftState.tasks);
}

function rebuildBoardColumns(tasks: Record<string, InternalTaskRecord>): BoardColumnsResult {
  return {
    columns: (Object.keys(boardColumnTitles) as TaskStatus[]).map((status) => ({
      status,
      title: boardColumnTitles[status],
      cards: Object.values(tasks)
        .filter((task) => task.status === status)
        .map((task) => ({
          taskId: task.taskId,
          conversationId: task.conversationId,
          title: task.title,
          status: task.status,
          projectName: task.projectId ? task.projectName : '프로젝트 미지정',
          lastActivity: task.lastActivity,
          lastActivityAt: task.lastActivityAt,
          toolSummary: task.toolSummary,
        })),
    })),
  };
}

function ensureTask(state: DesktopIpcState, taskId: string) {
  const task = state.tasks[taskId];

  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  return task;
}

function ensureProject(state: DesktopIpcState, projectId: string) {
  const project = state.projects[projectId];

  if (!project) {
    throw new Error(`Unknown project: ${projectId}`);
  }

  return project;
}

function ensureHistoryEntry(state: DesktopIpcState, runId: string) {
  const entry = state.historyEntries[runId];

  if (!entry) {
    throw new Error(`Unknown run: ${runId}`);
  }

  return entry;
}

function emitInvalidation(
  state: DesktopIpcState,
  broadcast: DesktopIpcBroadcaster | undefined,
  commandName: DesktopCommandName,
  targets: InvalidationTarget[],
) {
  if (!broadcast) {
    return;
  }

  const event: DesktopInvalidationEvent = {
    eventId: `event-${String(state.nextIds.event).padStart(3, '0')}`,
    issuedAt: nowIso(),
    source: {
      type: 'command',
      name: commandName,
    },
    targets,
  };

  state.nextIds.event += 1;
  broadcast(ipcChannels.events.invalidated, event);
}

export function createDesktopIpcService(options: RegisterDesktopIpcOptions = {}): DesktopIpcService {
  let state = clone(options.state ?? createInitialState());
  const boardService = options.boardService ?? null;
  const chatHistoryService = options.chatHistoryService ?? null;
  const historyInspectionService = options.historyInspectionService ?? null;
  const projectService = options.projectService ?? null;
  const settingsService = options.settingsService ?? createInMemoryAppSettingsService(defaultAppSettings);
  const translationAdapter = options.translationAdapter ?? null;
  const usageDashboardService = options.usageDashboardService ?? null;
  const workbenchService = options.workbenchService ?? null;

  async function resolvePreparedMutationResult<TResult>(
    outcome: PreparedMutationResult<TResult>,
  ): Promise<TResult> {
    if (outcome.commit) {
      return outcome.commit();
    }

    return outcome.result;
  }

  async function commitCommandMutation<TResult>(
    commandName: DesktopCommandName,
    work: (
      draftState: DesktopIpcState,
    ) => Promise<PreparedMutationResult<TResult>>,
  ) {
    const draftState = clone(state);
    const outcome = await work(draftState);

    await options.commitMutation?.(commandName, draftState);
    const result = await resolvePreparedMutationResult(outcome);

    state = draftState;
    emitInvalidation(state, options.broadcast, commandName, outcome.targets);

    return result;
  }

  const commands: CommandHandlerMap = {
    submitPrompt: async (request) =>
      commitCommandMutation('submitPrompt', async (draftState) => {
        if (chatHistoryService) {
          draftState.nextIds.task += 1;
          draftState.nextIds.conversation += 1;
          draftState.nextIds.message += 1;
          draftState.nextIds.run += 1;

          return {
            commit: async () => {
              const result = await chatHistoryService.submitPrompt(request);
              stageSubmittedPromptInState(draftState, request, result);

              return result;
            },
            targets: [
              {
                kind: 'entity',
                entity: 'task',
                ids: [],
              },
              {
                kind: 'entity',
                entity: 'conversation',
                ids: [],
              },
              {
                kind: 'entity',
                entity: 'run',
                ids: [],
              },
              {
                kind: 'projection',
                projection: 'chatFeed',
              },
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
              {
                kind: 'projection',
                projection: 'historyFeed',
              },
              {
                kind: 'projection',
                projection: 'historyEntry',
              },
              {
                kind: 'projection',
                projection: 'usageDashboard',
                keys: ['month', 'all_time'],
              },
            ],
          };
        }

        const taskId = `task-${String(draftState.nextIds.task).padStart(3, '0')}`;
        const conversationId =
          request.conversationId ??
          `conv-${String(draftState.nextIds.conversation).padStart(3, '0')}`;
        const messageId = `msg-${String(draftState.nextIds.message).padStart(3, '0')}`;
        const runId = `run-${String(draftState.nextIds.run).padStart(3, '0')}`;

        draftState.nextIds.task += 1;
        draftState.nextIds.conversation += 1;
        draftState.nextIds.message += 1;
        draftState.nextIds.run += 1;
        stageSubmittedPromptInState(draftState, request, {
          taskId,
          conversationId,
          messageId,
          runId,
        });

        return {
          result: {
            taskId,
            conversationId,
            messageId,
            runId,
            acceptedStatus: 'queued' as const,
          },
          targets: [
            {
              kind: 'entity',
              entity: 'task',
              ids: [taskId],
            },
            {
              kind: 'entity',
              entity: 'conversation',
              ids: [conversationId],
            },
            {
              kind: 'entity',
              entity: 'run',
              ids: [runId],
            },
          {
            kind: 'projection',
            projection: 'chatFeed',
          },
          {
            kind: 'projection',
            projection: 'workbenchLayout',
          },
          {
            kind: 'projection',
            projection: 'historyFeed',
          },
            {
              kind: 'projection',
              projection: 'historyEntry',
              keys: [runId],
            },
            {
              kind: 'projection',
              projection: 'usageDashboard',
              keys: ['month', 'all_time'],
            },
          ],
        };
      }),
    retryRun: async (request) =>
      commitCommandMutation('retryRun', async (draftState) => {
        if (chatHistoryService) {
          return {
            commit: async () => chatHistoryService.retryRun(request),
            targets: [
              {
                kind: 'entity',
                entity: 'run',
                ids: [request.runId],
              },
              {
                kind: 'projection',
                projection: 'chatFeed',
              },
              {
                kind: 'projection',
                projection: 'historyFeed',
              },
              {
                kind: 'projection',
                projection: 'historyEntry',
              },
            ],
          };
        }

        const retryRunId = `run-${String(draftState.nextIds.run).padStart(3, '0')}`;
        draftState.nextIds.run += 1;
        stageRetriedRunInState(draftState, request, {
          runId: retryRunId,
          acceptedStatus: 'queued' as const,
        });

        return {
          result: {
            runId: retryRunId,
            acceptedStatus: 'queued' as const,
          },
          targets: [
            {
              kind: 'entity',
              entity: 'run',
              ids: [request.runId, retryRunId],
            },
            {
              kind: 'projection',
              projection: 'chatFeed',
            },
            {
              kind: 'projection',
              projection: 'historyFeed',
            },
            {
              kind: 'projection',
              projection: 'historyEntry',
              keys: [request.runId, retryRunId],
            },
          ],
        };
      }),
    createProject: async (request) =>
      commitCommandMutation('createProject', async (draftState) => {
        if (!request.name.trim()) {
          throw new Error('프로젝트 이름을 입력해 주세요.');
        }

        const updatedAt = nowIso();

        if (projectService) {
          return {
            commit: async () => {
              const result = await projectService.createProject(request);
              stageCreatedProjectInState(draftState, request, result, updatedAt);

              return result;
            },
            targets: [
              {
                kind: 'entity',
                entity: 'project',
                ids: [],
              },
              {
                kind: 'projection',
                projection: 'projectList',
              },
            ],
          };
        }

        const projectId = `project-${String(Object.keys(draftState.projects).length + 1).padStart(3, '0')}`;
        stageCreatedProjectInState(
          draftState,
          request,
          {
            projectId,
          },
          updatedAt,
        );

        return {
          result: {
            projectId,
          },
          targets: [
            {
              kind: 'entity',
              entity: 'project',
              ids: [projectId],
            },
            {
              kind: 'projection',
              projection: 'projectList',
            },
          ],
        };
      }),
    updateProject: async (request) =>
      commitCommandMutation('updateProject', async (draftState) => {
        if (!request.name.trim()) {
          throw new Error('프로젝트 이름을 입력해 주세요.');
        }

        const updatedAt = nowIso();

        if (projectService) {
          return {
            commit: async () => {
              const result = await projectService.updateProject(request);
              stageUpdatedProjectInState(draftState, request, result);

              return result;
            },
            targets: [
              {
                kind: 'entity',
                entity: 'project',
                ids: [request.projectId],
              },
              {
                kind: 'projection',
                projection: 'projectList',
              },
              {
                kind: 'projection',
                projection: 'projectDetail',
                keys: [request.projectId],
              },
              {
                kind: 'projection',
                projection: 'boardColumns',
              },
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
            ],
          };
        }

        const result = {
          projectId: request.projectId,
          updatedAt,
        };
        stageUpdatedProjectInState(draftState, request, result);

        return {
          result,
          targets: [
            {
              kind: 'entity',
              entity: 'project',
              ids: [request.projectId],
            },
            {
              kind: 'projection',
              projection: 'projectList',
            },
            {
              kind: 'projection',
              projection: 'projectDetail',
              keys: [request.projectId],
            },
            {
              kind: 'projection',
              projection: 'boardColumns',
            },
            {
              kind: 'projection',
              projection: 'workbenchLayout',
            },
          ],
        };
      }),
    setTaskProject: async (request) =>
      commitCommandMutation('setTaskProject', async (draftState) => {
        const previousProjectId = ensureTask(draftState, request.taskId).projectId;
        const updatedAt = nowIso();

        if (projectService) {
          const affectedProjectIds = Array.from(
            new Set(
              [previousProjectId, request.projectId].filter(
                (projectId): projectId is string => projectId !== null,
              ),
            ),
          );

          return {
            commit: async () => {
              const result = await projectService.setTaskProject(request);
              stageSetTaskProjectInState(draftState, result, updatedAt);

              return result;
            },
            targets: [
              {
                kind: 'entity',
                entity: 'task',
                ids: [request.taskId],
              },
              {
                kind: 'entity',
                entity: 'project',
                ids: affectedProjectIds,
              },
              {
                kind: 'projection',
                projection: 'projectList',
              },
              {
                kind: 'projection',
                projection: 'boardColumns',
              },
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
              ...affectedProjectIds
                .map(
                  (projectId) =>
                    ({
                      kind: 'projection',
                      projection: 'projectDetail',
                      keys: [projectId],
                    }) satisfies InvalidationTarget,
                ),
            ],
          };
        }

        const result = {
          taskId: request.taskId,
          projectId: request.projectId,
          previousProjectId,
        };
        const affectedProjectIds = Array.from(
          new Set(
            [previousProjectId, request.projectId].filter(
              (projectId): projectId is string => projectId !== null,
            ),
          ),
        );
        stageSetTaskProjectInState(draftState, result, updatedAt);

        return {
          result,
          targets: [
            {
              kind: 'entity',
              entity: 'task',
              ids: [request.taskId],
            },
            {
              kind: 'entity',
              entity: 'project',
              ids: affectedProjectIds,
            },
            {
              kind: 'projection',
              projection: 'projectList',
            },
            {
              kind: 'projection',
              projection: 'boardColumns',
            },
            {
              kind: 'projection',
              projection: 'workbenchLayout',
            },
            ...affectedProjectIds
              .map(
                (projectId) =>
                  ({
                    kind: 'projection',
                    projection: 'projectDetail',
                    keys: [projectId],
                  }) satisfies InvalidationTarget,
              ),
          ],
        };
      }),
    openInWorkbench: async (request) =>
      commitCommandMutation('openInWorkbench', async (draftState) => {
        if (workbenchService) {
          return {
            commit: async () => workbenchService.openInWorkbench(request),
            targets: [
              {
                kind: 'entity',
                entity: 'task',
                ids: [request.taskId],
              },
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
            ],
          };
        }

        const task = ensureTask(draftState, request.taskId);
        const slot = resolveWorkbenchPanelSlot({
          panels: draftState.workbenchLayout.panels,
          taskId: task.taskId,
          requestedPanelSlot: request.panelSlot,
        });
        const panel = draftState.workbenchLayout.panels.find((currentPanel) => currentPanel.slot === slot);
        const activityAt = nowIso();

        if (!panel) {
          throw new Error(`Unknown panel slot: ${slot}`);
        }

        markTaskActivity(task, activityAt);
        panel.taskId = task.taskId;
        panel.title = task.title;
        panel.status = task.status;
        panel.note = `최근 활동 ${task.lastActivity} · ${task.projectName}`;
        panel.conversation = null;
        draftState.workbenchLayout.activePanelSlot = slot;
        draftState.workbenchLayout.updatedAt = activityAt;
        draftState.chatFeed.items = sortTasksForChatFeed(draftState.tasks);

        return {
          result: {
            layoutId: draftState.workbenchLayout.layoutId,
            taskId: task.taskId,
            panelSlot: slot,
          },
          targets: [
            {
              kind: 'entity',
              entity: 'task',
              ids: [task.taskId],
            },
            {
              kind: 'projection',
              projection: 'workbenchLayout',
              keys: [draftState.workbenchLayout.layoutId],
            },
          ],
        };
      }),
    moveWorkbenchPanel: async (request) =>
      commitCommandMutation('moveWorkbenchPanel', async (draftState) => {
        if (workbenchService) {
          return {
            commit: async () => workbenchService.moveWorkbenchPanel(request),
            targets: [
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
            ],
          };
        }

        const sourcePanel = draftState.workbenchLayout.panels.find(
          (panel) => panel.slot === request.fromPanelSlot,
        );
        const targetPanel = draftState.workbenchLayout.panels.find(
          (panel) => panel.slot === request.toPanelSlot,
        );

        if (!sourcePanel?.taskId) {
          throw new Error('이동할 패널 작업이 없습니다.');
        }

        if (!targetPanel) {
          throw new Error(`Unknown panel slot: ${request.toPanelSlot}`);
        }

        const movedTask = ensureTask(draftState, sourcePanel.taskId);
        const swappedTask = targetPanel.taskId ? ensureTask(draftState, targetPanel.taskId) : null;

        sourcePanel.taskId = swappedTask?.taskId ?? null;
        sourcePanel.title = swappedTask?.title ?? '새 작업을 열어보세요';
        sourcePanel.status = swappedTask?.status ?? 'idle';
        sourcePanel.note = swappedTask
          ? `최근 활동 ${swappedTask.lastActivity} · ${swappedTask.projectName}`
          : '작업을 끌어오거나 새 채팅을 시작하세요';
        sourcePanel.conversation = null;

        targetPanel.taskId = movedTask.taskId;
        targetPanel.title = movedTask.title;
        targetPanel.status = movedTask.status;
        targetPanel.note = `최근 활동 ${movedTask.lastActivity} · ${movedTask.projectName}`;
        targetPanel.conversation = null;
        draftState.workbenchLayout.activePanelSlot = request.toPanelSlot;
        draftState.workbenchLayout.updatedAt = nowIso();

        return {
          result: {
            layoutId: draftState.workbenchLayout.layoutId,
            taskId: movedTask.taskId,
            panelSlot: request.toPanelSlot,
          },
          targets: [
            {
              kind: 'projection',
              projection: 'workbenchLayout',
              keys: [draftState.workbenchLayout.layoutId],
            },
          ],
        };
      }),
    closeWorkbenchPanel: async (request) =>
      commitCommandMutation('closeWorkbenchPanel', async (draftState) => {
        if (workbenchService) {
          return {
            commit: async () => workbenchService.closeWorkbenchPanel(request),
            targets: [
              {
                kind: 'projection',
                projection: 'workbenchLayout',
              },
            ],
          };
        }

        const panel = draftState.workbenchLayout.panels.find(
          (currentPanel) => currentPanel.slot === request.panelSlot,
        );

        if (!panel) {
          throw new Error(`Unknown panel slot: ${request.panelSlot}`);
        }

        const closedTaskId = panel.taskId;
        panel.taskId = null;
        panel.title = '새 작업을 열어보세요';
        panel.status = 'idle';
        panel.note = '작업을 끌어오거나 새 채팅을 시작하세요';
        panel.conversation = null;
        draftState.workbenchLayout.activePanelSlot = getInMemoryNextActiveWorkbenchSlot(
          draftState.workbenchLayout.panels,
        );
        draftState.workbenchLayout.updatedAt = nowIso();

        return {
          result: {
            layoutId: draftState.workbenchLayout.layoutId,
            panelSlot: request.panelSlot,
            closedTaskId,
            activePanelSlot: draftState.workbenchLayout.activePanelSlot,
          },
          targets: [
            {
              kind: 'projection',
              projection: 'workbenchLayout',
              keys: [draftState.workbenchLayout.layoutId],
            },
          ],
        };
      }),
    moveTaskStatus: async (request) =>
      commitCommandMutation('moveTaskStatus', async (draftState) => {
        if (boardService) {
          return {
            commit: async () => boardService.moveTaskStatus(request),
            targets: [
              {
                kind: 'entity',
                entity: 'task',
                ids: [request.taskId],
              },
              {
                kind: 'projection',
                projection: 'boardColumns',
              },
            ],
          };
        }

        const task = ensureTask(draftState, request.taskId);

        task.status = request.status;
        markTaskActivity(task);
        draftState.boardColumns = rebuildBoardColumns(draftState.tasks);
        draftState.chatFeed.items = sortTasksForChatFeed(draftState.tasks);

        draftState.workbenchLayout.panels = draftState.workbenchLayout.panels.map((panel) =>
          panel.taskId === request.taskId
            ? {
                ...panel,
                status: request.status,
              }
            : panel,
        );

        return {
          result: {
            taskId: request.taskId,
            status: request.status,
          },
          targets: [
            {
              kind: 'entity',
              entity: 'task',
              ids: [request.taskId],
            },
            {
              kind: 'projection',
              projection: 'boardColumns',
            },
            ...(task.projectId
              ? ([
                  {
                    kind: 'projection',
                    projection: 'projectDetail',
                    keys: [task.projectId],
                  },
                ] satisfies InvalidationTarget[])
              : []),
          ],
        };
      }),
    updateSettings: async (request) =>
      commitCommandMutation('updateSettings', async (_draftState) => {
        const updatedKeys = Object.keys(request.patch) as Array<keyof AppSettings>;

        return {
          commit: async () => {
            const settings = await settingsService.updateSettings(request.patch);

            return {
              settings,
              updatedKeys,
            };
          },
          targets: [
            {
              kind: 'entity',
              entity: 'settings',
              ids: ['app-settings'],
            },
            {
              kind: 'projection',
              projection: 'settings',
            },
          ],
        };
      }),
  };

  const queries: QueryHandlerMap = {
    getChatFeed: async (request) =>
      chatHistoryService
        ? chatHistoryService.getChatFeed(request)
        : {
            ...clone(state.chatFeed),
            activeConversationId: request.conversationId ?? state.chatFeed.activeConversationId,
          },
    getWorkbenchLayout: async (request) =>
      workbenchService
        ? workbenchService.getWorkbenchLayout(request)
        : buildWorkbenchLayoutFromState(state),
    getBoardColumns: async () =>
      boardService
        ? boardService.getBoardColumns({})
        : clone(state.boardColumns),
    getProjectList: async () =>
      projectService
        ? projectService.getProjectList({})
        : clone(buildProjectListFromState(state)),
    getProjectDetail: async (request) =>
      projectService
        ? projectService.getProjectDetail(request)
        : clone(buildProjectDetailFromState(state, request.projectId)),
    getUsageDashboard: async (request) =>
      usageDashboardService
        ? usageDashboardService.getUsageDashboard(request)
        : clone(state.usageDashboards[request.range]),
    getHistoryFeed: async (request) =>
      historyInspectionService
        ? historyInspectionService.getHistoryFeed(request)
        : clone(buildHistoryFeedFromState(state)),
    getHistoryEntry: async (request) =>
      historyInspectionService
        ? historyInspectionService.getHistoryEntry(request)
        : clone(ensureHistoryEntry(state, request.runId)),
    getSettings: async () => settingsService.getSettings(),
  };

  return {
    commands,
    queries,
    translationAdapter,
  };
}

function registerCommandHandler<TName extends DesktopCommandName>(
  ipcMain: DesktopIpcMainLike,
  service: DesktopIpcService,
  name: TName,
) {
  ipcMain.handle(
    ipcChannels.commands[name],
    (_event, request: DesktopCommandRequest<TName>) => service.commands[name](request),
  );
}

function registerQueryHandler<TName extends DesktopQueryName>(
  ipcMain: DesktopIpcMainLike,
  service: DesktopIpcService,
  name: TName,
) {
  ipcMain.handle(
    ipcChannels.queries[name],
    (_event, request: DesktopQueryRequest<TName>) => service.queries[name](request),
  );
}

export function registerDesktopIpcHandlers(
  ipcMain: DesktopIpcMainLike,
  options: RegisterDesktopIpcOptions = {},
) {
  const service = createDesktopIpcService(options);

  for (const commandName of commandNames) {
    registerCommandHandler(ipcMain, service, commandName);
  }

  for (const queryName of queryNames) {
    registerQueryHandler(ipcMain, service, queryName);
  }

  return service;
}
