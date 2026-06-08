export const commandNames = [
  'submitPrompt',
  'retryRun',
  'openInWorkbench',
  'moveTaskStatus',
  'updateSettings',
] as const;

export const queryNames = [
  'getChatFeed',
  'getWorkbenchLayout',
  'getBoardColumns',
  'getProjectDetail',
  'getUsageDashboard',
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
    openInWorkbench: 'talkin-ai:command:openInWorkbench',
    moveTaskStatus: 'talkin-ai:command:moveTaskStatus',
    updateSettings: 'talkin-ai:command:updateSettings',
  },
  queries: {
    getChatFeed: 'talkin-ai:query:getChatFeed',
    getWorkbenchLayout: 'talkin-ai:query:getWorkbenchLayout',
    getBoardColumns: 'talkin-ai:query:getBoardColumns',
    getProjectDetail: 'talkin-ai:query:getProjectDetail',
    getUsageDashboard: 'talkin-ai:query:getUsageDashboard',
    getHistoryEntry: 'talkin-ai:query:getHistoryEntry',
    getSettings: 'talkin-ai:query:getSettings',
  },
  events: {
    invalidated: 'talkin-ai:event:invalidated',
  },
};

export type CloudModelId = 'gpt-4.1' | 'claude-sonnet-4' | 'gemini-1.5-pro';
export type OptimizationMode = 'balanced' | 'savings' | 'quality' | 'long_context';
export type TaskStatus = 'planning' | 'in_progress' | 'ai_review' | 'human_review' | 'completed';
export type PanelSlot = 'north-west' | 'north-east' | 'south-west' | 'south-east';
export type EmptyPayload = Record<string, never>;

export type AppSettings = {
  defaultModel: CloudModelId;
  optimizationMode: OptimizationMode;
  responseLanguage: 'ko';
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

export type ChatFeedRunSummary = {
  runId: string;
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
  activeRun: ChatFeedRunSummary | null;
};

export type WorkbenchPanel = {
  slot: PanelSlot;
  taskId: string | null;
  title: string;
  status: TaskStatus | 'idle';
  note: string;
};

export type WorkbenchLayoutQuery = {
  layoutId?: string;
};

export type WorkbenchLayoutResult = {
  layoutId: string;
  updatedAt: string;
  panels: WorkbenchPanel[];
};

export type BoardTaskCard = {
  taskId: string;
  title: string;
  projectName: string;
  lastActivity: string;
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

export type ProjectDetailQuery = {
  projectId: string;
};

export type ProjectTaskSummary = {
  taskId: string;
  title: string;
  status: TaskStatus;
};

export type ProjectDetailResult = {
  projectId: string;
  name: string;
  description: string;
  goal: string;
  files: string[];
  tasks: ProjectTaskSummary[];
};

export type UsageDashboardQuery = {
  range: 'month' | 'all_time';
};

export type UsageDashboardResult = {
  range: 'month' | 'all_time';
  totals: {
    baselineTokens: number;
    optimizedTokens: number;
    savingsRate: number;
    estimatedSavingsUsd: number;
  };
  categories: Array<{
    name: string;
    share: number;
  }>;
};

export type HistoryEntryQuery = {
  runId: string;
};

export type HistoryEntryResult = {
  runId: string;
  taskId: string;
  promptKo: string;
  optimizedPromptEn: string;
  restoredResponseKo: string;
  baselineTokens: number;
  optimizedTokens: number;
  savingsRate: number;
  provider: CloudModelId;
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

export type OpenInWorkbenchCommand = {
  taskId: string;
  panelSlot?: PanelSlot;
};

export type OpenInWorkbenchResult = {
  layoutId: string;
  taskId: string;
  panelSlot: PanelSlot;
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
  openInWorkbench: {
    request: OpenInWorkbenchCommand;
    response: OpenInWorkbenchResult;
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
  getProjectDetail: {
    request: ProjectDetailQuery;
    response: ProjectDetailResult;
  };
  getUsageDashboard: {
    request: UsageDashboardQuery;
    response: UsageDashboardResult;
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
      entity: 'task' | 'conversation' | 'run' | 'settings';
      ids: string[];
    }
  | {
      kind: 'projection';
      projection:
        | 'chatFeed'
        | 'workbenchLayout'
        | 'boardColumns'
        | 'projectDetail'
        | 'usageDashboard'
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
