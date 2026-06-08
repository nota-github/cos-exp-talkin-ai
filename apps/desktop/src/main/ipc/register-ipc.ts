import {
  commandNames,
  ipcChannels,
  queryNames,
  type AppSettings,
  type ChatFeedMessage,
  type BoardColumnsResult,
  type ChatFeedRunSummary,
  type DesktopCommandName,
  type DesktopCommandRequest,
  type DesktopCommandResponse,
  type DesktopInvalidationEvent,
  type DesktopQueryName,
  type DesktopQueryRequest,
  type DesktopQueryResponse,
  type HistoryEntryResult,
  type InvalidationTarget,
  type PanelSlot,
  type ProjectDetailResult,
  type TaskStatus,
  type UsageDashboardResult,
  type WorkbenchLayoutResult,
} from '../../shared/ipc/contracts';
import type { ChatHistoryService } from '../chat/index.ts';
import {
  createInMemoryAppSettingsService,
  defaultAppSettings,
  type AppSettingsService,
} from '../settings/index.ts';
import type { TranslationMcpAdapter } from '../translation/index.ts';

type InternalTaskRecord = {
  taskId: string;
  conversationId: string;
  title: string;
  preview: string;
  projectId: string;
  projectName: string;
  status: TaskStatus;
  model: AppSettings['defaultModel'];
  mode: AppSettings['optimizationMode'];
  savingsRate: number;
  lastActivity: string;
  toolSummary: string;
};

type DesktopIpcState = {
  chatFeed: DesktopQueryResponse<'getChatFeed'>;
  workbenchLayout: WorkbenchLayoutResult;
  boardColumns: BoardColumnsResult;
  projects: Record<string, ProjectDetailResult>;
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
  chatHistoryService?: ChatHistoryService;
  commitMutation?: (
    commandName: DesktopCommandName,
    nextState: DesktopIpcState,
  ) => Promise<void> | void;
  state?: DesktopIpcState;
  settingsService?: AppSettingsService;
  translationAdapter?: TranslationMcpAdapter;
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

const panelSlots: PanelSlot[] = [
  'north-west',
  'north-east',
  'south-west',
  'south-east',
];

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function createInitialState(): DesktopIpcState {
  const primaryTask: InternalTaskRecord = {
    taskId: 'task-001',
    conversationId: 'conv-001',
    title: '신규 파트너 제안서 초안',
    preview: '제품 개요와 시장 진입 전략이 보이는 목차부터 정리해줘.',
    projectId: 'project-001',
    projectName: '사업계획서',
    status: 'in_progress',
    model: 'claude-sonnet-4',
    mode: 'quality',
    savingsRate: 34,
    lastActivity: '5분 전',
    toolSummary: 'Claude Sonnet · 품질 우선',
  };

  const researchTask: InternalTaskRecord = {
    taskId: 'task-002',
    conversationId: 'conv-002',
    title: '40페이지 리서치 요약',
    preview: '긴 PDF 핵심만 7개 항목으로 묶어줘.',
    projectId: 'project-002',
    projectName: '제품 리서치',
    status: 'ai_review',
    model: 'gpt-4.1',
    mode: 'long_context',
    savingsRate: 41,
    lastActivity: '12분 전',
    toolSummary: 'GPT-4.1 · 긴 컨텍스트',
  };

  const polishTask: InternalTaskRecord = {
    taskId: 'task-003',
    conversationId: 'conv-003',
    title: '운영 공지 카피 다듬기',
    preview: '톤은 부드럽게 유지하고 핵심 일정은 더 또렷하게.',
    projectId: 'project-003',
    projectName: '운영 공지',
    status: 'planning',
    model: 'gemini-1.5-pro',
    mode: 'balanced',
    savingsRate: 27,
    lastActivity: '방금',
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
        files: ['partner-brief.pdf', 'pricing-notes.docx'],
        tasks: [
          {
            taskId: primaryTask.taskId,
            title: primaryTask.title,
            status: primaryTask.status,
          },
        ],
      },
      'project-002': {
        projectId: 'project-002',
        name: '제품 리서치',
        description: '장문 자료 요약과 비교 분석을 관리하는 프로젝트',
        goal: '핵심 경쟁사 포지셔닝을 1페이지 요약으로 축약',
        files: ['research-pack.pdf'],
        tasks: [
          {
            taskId: researchTask.taskId,
            title: researchTask.title,
            status: researchTask.status,
          },
        ],
      },
      'project-003': {
        projectId: 'project-003',
        name: '운영 공지',
        description: '사용자-facing 운영 메시지와 카피 수정',
        goal: '짧지만 오해 없는 공지 톤 정리',
        files: [],
        tasks: [
          {
            taskId: polishTask.taskId,
            title: polishTask.title,
            status: polishTask.status,
          },
        ],
      },
    },
    usageDashboards: {
      month: {
        range: 'month',
        totals: {
          baselineTokens: 18240,
          optimizedTokens: 10810,
          savingsRate: 41,
          estimatedSavingsUsd: 12.6,
        },
        categories: [
          { name: '문서 요약', share: 44 },
          { name: '사업계획서', share: 33 },
          { name: '카피 다듬기', share: 23 },
        ],
      },
      all_time: {
        range: 'all_time',
        totals: {
          baselineTokens: 54310,
          optimizedTokens: 32140,
          savingsRate: 41,
          estimatedSavingsUsd: 37.4,
        },
        categories: [
          { name: '문서 요약', share: 39 },
          { name: '사업계획서', share: 35 },
          { name: '카피 다듬기', share: 26 },
        ],
      },
    },
    historyEntries: {
      'run-001': {
        runId: 'run-001',
        taskId: primaryTask.taskId,
        promptKo: '시장 진입 전략이 보이도록 사업계획서 초안을 목차 중심으로 정리해줘.',
        optimizedPromptEn:
          'Draft a business plan outline focused on market entry strategy. Preserve headings and numbered sections.',
        restoredResponseKo:
          '시장 진입 전략을 먼저 보여주는 구조로 사업계획서 목차 초안을 정리했습니다.',
        baselineTokens: 1240,
        optimizedTokens: 756,
        savingsRate: 39,
        provider: 'claude-sonnet-4',
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
    .sort((left, right) => right.taskId.localeCompare(left.taskId))
    .map((task) => ({
      taskId: task.taskId,
      conversationId: task.conversationId,
      title: task.title,
      preview: task.preview,
      status: task.status,
      model: task.model,
      mode: task.mode,
      savingsRate: task.savingsRate,
      updatedAt: task.lastActivity,
    }));
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
  const projectId = request.projectId ?? 'project-001';
  const project = ensureProject(draftState, projectId);
  const title = request.promptKo.slice(0, 24) || '새 한국어 작업';
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
    projectName: project.name,
    status: 'planning',
    model: request.selectedModel,
    mode: request.optimizationMode,
    savingsRate,
    lastActivity: '방금',
    toolSummary: `${request.selectedModel} · ${request.optimizationMode}`,
  };

  project.tasks.unshift({
    taskId: ids.taskId,
    title,
    status: 'planning',
  });

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
    promptKo: request.promptKo,
    optimizedPromptEn:
      'Condense the Korean task into an English prompt while preserving constraints, nouns, and output structure.',
    restoredResponseKo:
      '이 작업은 로컬 최적화 이후 클라우드 추론을 기다리는 상태입니다.',
    baselineTokens: tokenBaseline,
    optimizedTokens: tokenOptimized,
    savingsRate,
    provider: request.selectedModel,
  };

  draftState.usageDashboards.month.totals.baselineTokens += tokenBaseline;
  draftState.usageDashboards.month.totals.optimizedTokens += tokenOptimized;
  draftState.usageDashboards.all_time.totals.baselineTokens += tokenBaseline;
  draftState.usageDashboards.all_time.totals.optimizedTokens += tokenOptimized;
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
    restoredResponseKo:
      '재시도 요청이 접수되었습니다. 이전 한국어 입력과 기존 응답은 그대로 유지됩니다.',
  };
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
          title: task.title,
          projectName: task.projectName,
          lastActivity: task.lastActivity,
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
  const chatHistoryService = options.chatHistoryService ?? null;
  const settingsService = options.settingsService ?? createInMemoryAppSettingsService(defaultAppSettings);
  const translationAdapter = options.translationAdapter ?? null;

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
              projection: 'historyEntry',
              keys: [request.runId, retryRunId],
            },
          ],
        };
      }),
    openInWorkbench: async (request) =>
      commitCommandMutation('openInWorkbench', async (draftState) => {
        const task = ensureTask(draftState, request.taskId);
        const slot =
          request.panelSlot ??
          draftState.workbenchLayout.panels.find((panel) => panel.taskId === null)?.slot ??
          panelSlots[0];
        const panel = draftState.workbenchLayout.panels.find((currentPanel) => currentPanel.slot === slot);

        if (!panel) {
          throw new Error(`Unknown panel slot: ${slot}`);
        }

        panel.taskId = task.taskId;
        panel.title = task.title;
        panel.status = task.status;
        panel.note = '작업대에서 이어지는 활성 작업';
        draftState.workbenchLayout.updatedAt = nowIso();

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
    moveTaskStatus: async (request) =>
      commitCommandMutation('moveTaskStatus', async (draftState) => {
        const task = ensureTask(draftState, request.taskId);
        const project = ensureProject(draftState, task.projectId);

        task.status = request.status;
        task.lastActivity = '방금';
        draftState.boardColumns = rebuildBoardColumns(draftState.tasks);

        project.tasks = project.tasks.map((projectTask) =>
          projectTask.taskId === request.taskId
            ? {
                ...projectTask,
                status: request.status,
              }
            : projectTask,
        );

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
            {
              kind: 'projection',
              projection: 'projectDetail',
              keys: [project.projectId],
            },
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
    getWorkbenchLayout: async () => clone(state.workbenchLayout),
    getBoardColumns: async () => clone(state.boardColumns),
    getProjectDetail: async (request) => clone(ensureProject(state, request.projectId)),
    getUsageDashboard: async (request) => clone(state.usageDashboards[request.range]),
    getHistoryEntry: async (request) => clone(ensureHistoryEntry(state, request.runId)),
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
