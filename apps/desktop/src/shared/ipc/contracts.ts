export const commandNames = [
  'submitPrompt',
  'retryRun',
  'createProject',
  'updateProject',
  'setTaskProject',
  'openInWorkbench',
  'moveWorkbenchPanel',
  'closeWorkbenchPanel',
  'moveTaskStatus',
  'updateSettings',
] as const;

export const queryNames = [
  'getChatFeed',
  'getWorkbenchLayout',
  'getBoardColumns',
  'getProjectList',
  'getProjectDetail',
  'getUsageDashboard',
  'getHistoryFeed',
  'getHistoryEntry',
  'getSettings',
] as const;

export type DesktopCommandName = (typeof commandNames)[number];
export type DesktopQueryName = (typeof queryNames)[number];

export const ipcChannels: {
  commands: Record<DesktopCommandName, string>;
  queries: Record<DesktopQueryName, string>;
  events: {
    invalidated: string;
  };
} = {
  commands: {
    submitPrompt: 'talkin-ai:command:submitPrompt',
    retryRun: 'talkin-ai:command:retryRun',
    createProject: 'talkin-ai:command:createProject',
    updateProject: 'talkin-ai:command:updateProject',
    setTaskProject: 'talkin-ai:command:setTaskProject',
    openInWorkbench: 'talkin-ai:command:openInWorkbench',
    moveWorkbenchPanel: 'talkin-ai:command:moveWorkbenchPanel',
    closeWorkbenchPanel: 'talkin-ai:command:closeWorkbenchPanel',
    moveTaskStatus: 'talkin-ai:command:moveTaskStatus',
    updateSettings: 'talkin-ai:command:updateSettings',
  },
  queries: {
    getChatFeed: 'talkin-ai:query:getChatFeed',
    getWorkbenchLayout: 'talkin-ai:query:getWorkbenchLayout',
    getBoardColumns: 'talkin-ai:query:getBoardColumns',
    getProjectList: 'talkin-ai:query:getProjectList',
    getProjectDetail: 'talkin-ai:query:getProjectDetail',
    getUsageDashboard: 'talkin-ai:query:getUsageDashboard',
    getHistoryFeed: 'talkin-ai:query:getHistoryFeed',
    getHistoryEntry: 'talkin-ai:query:getHistoryEntry',
    getSettings: 'talkin-ai:query:getSettings',
  },
  events: {
    invalidated: 'talkin-ai:event:invalidated',
  },
};

export type CloudModelId = 'gpt-4.1' | 'claude-sonnet-4' | 'gemini-1.5-pro';
export type ProviderId = 'openai' | 'anthropic' | 'google';
export type OptimizationMode = 'balanced' | 'savings' | 'quality' | 'long_context';
export type TaskStatus = 'planning' | 'in_progress' | 'ai_review' | 'human_review' | 'completed';
export type PanelSlot = 'north-west' | 'north-east' | 'south-west' | 'south-east';
export type EmptyPayload = Record<string, never>;

export type AppSettings = {
  defaultModel: CloudModelId;
  optimizationMode: OptimizationMode;
  responseLanguage: 'ko' | 'en';
  theme: 'light' | 'dark' | 'system';
  advancedPromptPreview: boolean;
};

export type ChatFeedItem = {
  taskId: string;
  conversationId: string;
  title: string;
  preview: string;
  status: TaskStatus;
  model: CloudModelId;
  mode: OptimizationMode;
  savingsRate: number;
  updatedAt: string;
};

export type ChatFeedMessage = {
  messageId: string;
  conversationId: string;
  runId: string | null;
  role: 'user' | 'assistant' | 'system';
  contentKo: string;
  createdAt: string;
};

export type ChatFeedRunFailureSummary = {
  failedStage:
    | 'queued'
    | 'optimizing'
    | 'optimized'
    | 'cloud_pending'
    | 'restoring'
    | 'completed'
    | 'failed'
    | null;
  message: string | null;
  guidance: string | null;
  retryable: boolean | null;
};

export type ChatFeedRunUsageSummary = {
  baselineInputTokens: number;
  optimizedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  savingsRate: number;
  isEstimated: boolean;
};

export type ChatFeedRunSummary = {
  runId: string;
  sourceMessageId: string;
  status:
    | 'queued'
    | 'optimizing'
    | 'optimized'
    | 'cloud_pending'
    | 'restoring'
    | 'completed'
    | 'failed';
  stage:
    | 'queued'
    | 'optimizing'
    | 'optimized'
    | 'cloud_pending'
    | 'restoring'
    | 'completed'
    | 'failed'
    | null;
  model: CloudModelId;
  mode: OptimizationMode;
  errorCode: string | null;
  failure: ChatFeedRunFailureSummary | null;
  usage?: ChatFeedRunUsageSummary | null;
};

export type ChatFeedQuery = {
  conversationId?: string;
};

export type ChatFeedResult = {
  activeConversationId: string | null;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  recommendedPrompts: string[];
  items: ChatFeedItem[];
  messages: ChatFeedMessage[];
  runs: ChatFeedRunSummary[];
  activeRun: ChatFeedRunSummary | null;
};

export type WorkbenchPanelConversation = {
  conversationId: string;
  messages: ChatFeedMessage[];
  runs: ChatFeedRunSummary[];
  activeRun: ChatFeedRunSummary | null;
};

export type WorkbenchPanel = {
  slot: PanelSlot;
  taskId: string | null;
  title: string;
  status: TaskStatus | 'idle';
  note: string;
  conversation: WorkbenchPanelConversation | null;
};

export type WorkbenchRecentTask = {
  taskId: string;
  title: string;
  projectName: string;
  status: TaskStatus;
  lastActivity: string;
  lastActivityAt: string;
  toolSummary: string;
  savingsRate: number;
  panelSlot: PanelSlot | null;
  isOpen: boolean;
};

export type WorkbenchLayoutQuery = {
  layoutId?: string;
};

export type WorkbenchLayoutResult = {
  layoutId: string;
  updatedAt: string;
  activePanelSlot: PanelSlot | null;
  recentTasks: WorkbenchRecentTask[];
  panels: WorkbenchPanel[];
};

export type BoardTaskCard = {
  taskId: string;
  conversationId: string | null;
  title: string;
  status: TaskStatus;
  projectName: string;
  lastActivity: string;
  lastActivityAt: string;
  toolSummary: string;
};

export type BoardColumn = {
  status: TaskStatus;
  title: string;
  cards: BoardTaskCard[];
};

export type BoardColumnsQuery = EmptyPayload;

export type BoardColumnsResult = {
  columns: BoardColumn[];
};

export type ProjectListQuery = EmptyPayload;

export type ProjectListItem = {
  projectId: string;
  name: string;
  description: string;
  goal: string;
  taskCount: number;
  fileCount: number;
  updatedAt: string;
  lastActivityAt: string;
  lastActivity: string;
};

export type ProjectLinkableTask = {
  taskId: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  projectName: string | null;
  sourceScreen: 'chat' | 'workbench' | 'projects' | 'kanban';
  lastActivity: string;
  lastActivityAt: string;
};

export type ProjectListResult = {
  projects: ProjectListItem[];
  recentTasks: ProjectLinkableTask[];
};

export type ProjectDetailQuery = {
  projectId: string;
};

export type ProjectTaskSummary = {
  taskId: string;
  title: string;
  status: TaskStatus;
  lastActivity: string;
  lastActivityAt: string;
};

export type ProjectDetailResult = {
  projectId: string;
  name: string;
  description: string;
  goal: string;
  updatedAt: string;
  files: string[];
  tasks: ProjectTaskSummary[];
};

export type UsageDashboardQuery = {
  range: 'month' | 'all_time';
};

export type UsageDashboardCategoryId = 'general' | 'starter_template' | 'project_linked';

export type UsageDashboardPricingBasis = {
  provider: ProviderId;
  model: CloudModelId;
  pricingVersion: string;
  requestCount: number;
};

export type UsageDashboardResult = {
  range: 'month' | 'all_time';
  pricingBasis: {
    status: 'empty' | 'single' | 'mixed';
    activeBasis: UsageDashboardPricingBasis | null;
    bases: UsageDashboardPricingBasis[];
  };
  categoryShareBasis: 'baseline_tokens' | 'request_count';
  totals: {
    requestCount: number;
    baselineTokens: number;
    optimizedTokens: number;
    tokenReduction: number;
    savingsRate: number;
    estimatedSavingsUsd: number;
  };
  comparison: {
    withoutOptimization: {
      requestCount: number;
      inputTokens: number;
      estimatedCostUsd: number;
    };
    withOptimization: {
      requestCount: number;
      inputTokens: number;
      estimatedCostUsd: number;
    };
  };
  categories: Array<{
    id: UsageDashboardCategoryId;
    label: string;
    requestCount: number;
    baselineTokens: number;
    optimizedTokens: number;
    tokenReduction: number;
    savingsRate: number;
    share: number;
  }>;
};

export type HistoryEntryQuery = {
  runId: string;
};

export type HistoryFeedQuery = EmptyPayload;

export type HistoryFeedItem = {
  runId: string;
  taskId: string;
  title: string;
  finalResponsePreview: string;
  model: CloudModelId;
  mode: OptimizationMode;
  completedAt: string | null;
  savingsRate: number;
  tokenReduction: number;
};

export type HistoryFeedResult = {
  items: HistoryFeedItem[];
};

export type HistoryArtifactEvidence = {
  content: string;
  tokenEstimate: number | null;
};

export type HistoryEntryUsageSummary = {
  baselineInputTokens: number;
  optimizedInputTokens: number;
  outputTokens: number;
  tokenReduction: number;
  savingsRate: number;
  estimatedSavingsUsd: number;
  pricingVersion: string;
  isEstimated: boolean;
};

export type HistoryEntryResult = {
  runId: string;
  taskId: string;
  title: string;
  model: CloudModelId;
  mode: OptimizationMode;
  completedAt: string | null;
  sourcePromptKo: HistoryArtifactEvidence;
  optimizedPromptEn: HistoryArtifactEvidence | null;
  providerResponseEn: HistoryArtifactEvidence | null;
  finalResponseKo: HistoryArtifactEvidence;
  usage: HistoryEntryUsageSummary;
};

export type SettingsQuery = EmptyPayload;

export type SubmitPromptCommand = {
  promptKo: string;
  selectedModel: CloudModelId;
  optimizationMode: OptimizationMode;
  conversationId?: string;
  projectId?: string;
};

export type SubmitPromptResult = {
  taskId: string;
  conversationId: string;
  messageId: string;
  runId: string;
  acceptedStatus: 'queued';
};

export type RetryRunCommand = {
  runId: string;
};

export type RetryRunResult = {
  runId: string;
  acceptedStatus: 'queued';
};

export type CreateProjectCommand = {
  name: string;
  description: string;
  goal: string;
};

export type CreateProjectResult = {
  projectId: string;
};

export type UpdateProjectCommand = {
  projectId: string;
  name: string;
  description: string;
  goal: string;
};

export type UpdateProjectResult = {
  projectId: string;
  updatedAt: string;
};

export type SetTaskProjectCommand = {
  taskId: string;
  projectId: string | null;
};

export type SetTaskProjectResult = {
  taskId: string;
  projectId: string | null;
  previousProjectId: string | null;
};

export type OpenInWorkbenchCommand = {
  taskId: string;
  panelSlot?: PanelSlot;
};

export type OpenInWorkbenchResult = {
  layoutId: string;
  taskId: string;
  panelSlot: PanelSlot;
};

export type MoveWorkbenchPanelCommand = {
  fromPanelSlot: PanelSlot;
  toPanelSlot: PanelSlot;
};

export type MoveWorkbenchPanelResult = {
  layoutId: string;
  taskId: string;
  panelSlot: PanelSlot;
};

export type CloseWorkbenchPanelCommand = {
  panelSlot: PanelSlot;
};

export type CloseWorkbenchPanelResult = {
  layoutId: string;
  panelSlot: PanelSlot;
  closedTaskId: string | null;
  activePanelSlot: PanelSlot | null;
};

export type MoveTaskStatusCommand = {
  taskId: string;
  status: TaskStatus;
};

export type MoveTaskStatusResult = {
  taskId: string;
  status: TaskStatus;
};

export type UpdateSettingsCommand = {
  patch: Partial<AppSettings>;
};

export type UpdateSettingsResult = {
  settings: AppSettings;
  updatedKeys: Array<keyof AppSettings>;
};

export type DesktopCommandDefinitions = {
  submitPrompt: {
    request: SubmitPromptCommand;
    response: SubmitPromptResult;
  };
  retryRun: {
    request: RetryRunCommand;
    response: RetryRunResult;
  };
  createProject: {
    request: CreateProjectCommand;
    response: CreateProjectResult;
  };
  updateProject: {
    request: UpdateProjectCommand;
    response: UpdateProjectResult;
  };
  setTaskProject: {
    request: SetTaskProjectCommand;
    response: SetTaskProjectResult;
  };
  openInWorkbench: {
    request: OpenInWorkbenchCommand;
    response: OpenInWorkbenchResult;
  };
  moveWorkbenchPanel: {
    request: MoveWorkbenchPanelCommand;
    response: MoveWorkbenchPanelResult;
  };
  closeWorkbenchPanel: {
    request: CloseWorkbenchPanelCommand;
    response: CloseWorkbenchPanelResult;
  };
  moveTaskStatus: {
    request: MoveTaskStatusCommand;
    response: MoveTaskStatusResult;
  };
  updateSettings: {
    request: UpdateSettingsCommand;
    response: UpdateSettingsResult;
  };
};

export type DesktopQueryDefinitions = {
  getChatFeed: {
    request: ChatFeedQuery;
    response: ChatFeedResult;
  };
  getWorkbenchLayout: {
    request: WorkbenchLayoutQuery;
    response: WorkbenchLayoutResult;
  };
  getBoardColumns: {
    request: BoardColumnsQuery;
    response: BoardColumnsResult;
  };
  getProjectList: {
    request: ProjectListQuery;
    response: ProjectListResult;
  };
  getProjectDetail: {
    request: ProjectDetailQuery;
    response: ProjectDetailResult;
  };
  getUsageDashboard: {
    request: UsageDashboardQuery;
    response: UsageDashboardResult;
  };
  getHistoryFeed: {
    request: HistoryFeedQuery;
    response: HistoryFeedResult;
  };
  getHistoryEntry: {
    request: HistoryEntryQuery;
    response: HistoryEntryResult;
  };
  getSettings: {
    request: SettingsQuery;
    response: AppSettings;
  };
};

export type InvalidationTarget =
  | {
      kind: 'entity';
      entity: 'task' | 'conversation' | 'run' | 'project' | 'settings';
      ids: string[];
    }
  | {
      kind: 'projection';
      projection:
        | 'chatFeed'
        | 'workbenchLayout'
        | 'boardColumns'
        | 'projectList'
        | 'projectDetail'
        | 'usageDashboard'
        | 'historyFeed'
        | 'historyEntry'
        | 'settings';
      keys?: string[];
    };

export type DesktopInvalidationEvent = {
  eventId: string;
  issuedAt: string;
  source:
    | {
        type: 'command';
        name: DesktopCommandName;
      }
    | {
        type: 'system';
        name: 'bootstrap';
      };
  targets: InvalidationTarget[];
};

export type DesktopCommandRequest<TName extends DesktopCommandName> =
  DesktopCommandDefinitions[TName]['request'];
export type DesktopCommandResponse<TName extends DesktopCommandName> =
  DesktopCommandDefinitions[TName]['response'];
export type DesktopQueryRequest<TName extends DesktopQueryName> =
  DesktopQueryDefinitions[TName]['request'];
export type DesktopQueryResponse<TName extends DesktopQueryName> =
  DesktopQueryDefinitions[TName]['response'];

export type DesktopShellInfo = {
  channel: 'desktop-shell';
  platform: string;
};

export type DesktopCommandCallerMap = {
  [TName in DesktopCommandName]: (
    request: DesktopCommandRequest<TName>,
  ) => Promise<DesktopCommandResponse<TName>>;
};

export type DesktopQueryCallerMap = {
  [TName in DesktopQueryName]: (
    request: DesktopQueryRequest<TName>,
  ) => Promise<DesktopQueryResponse<TName>>;
};

export type DesktopEventBridge = {
  onInvalidation: (listener: (payload: DesktopInvalidationEvent) => void) => () => void;
};

export type TalkinAIDesktopApi = {
  shell: DesktopShellInfo;
  ipc: {
    commands: DesktopCommandCallerMap;
    queries: DesktopQueryCallerMap;
    events: DesktopEventBridge;
  };
};
