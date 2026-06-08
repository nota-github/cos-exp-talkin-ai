import type {
  CloudModelId,
  OptimizationMode,
  TaskStatus,
} from '../../shared/ipc/contracts';
import type { SqliteConnection } from './database';

export const taskSourceScreens = ['chat', 'workbench', 'projects', 'kanban'] as const;
export type TaskSourceScreen = (typeof taskSourceScreens)[number];

export const taskUsageCategories = ['general', 'starter_template', 'project_linked'] as const;
export type TaskUsageCategory = (typeof taskUsageCategories)[number];

export const chatMessageRoles = ['user', 'assistant', 'system'] as const;
export type ChatMessageRole = (typeof chatMessageRoles)[number];

export const runStatuses = [
  'queued',
  'optimizing',
  'optimized',
  'cloud_pending',
  'restoring',
  'completed',
  'failed',
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const providerIds = ['openai', 'anthropic', 'google'] as const;
export type ProviderId = (typeof providerIds)[number];

export const runStageNames = [
  'queued',
  'optimizing',
  'optimized',
  'cloud_pending',
  'restoring',
  'completed',
  'failed',
] as const;
export type RunStageName = (typeof runStageNames)[number];

export const runStageStatuses = ['pending', 'running', 'completed', 'failed'] as const;
export type RunStageStatus = (typeof runStageStatuses)[number];

export const promptArtifactTypes = [
  'optimized_prompt_en',
  'provider_response_en',
  'restored_response_ko',
  'preservation_check',
] as const;
export type PromptArtifactType = (typeof promptArtifactTypes)[number];

export const artifactVisibilityLevels = ['hidden', 'advanced', 'default'] as const;
export type ArtifactVisibility = (typeof artifactVisibilityLevels)[number];

export type JsonObject = Record<string, unknown>;

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string | null;
  sourceScreen: TaskSourceScreen;
  usageCategory: TaskUsageCategory;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type ConversationRecord = {
  id: string;
  taskId: string;
  summary: string | null;
  mode: OptimizationMode;
  selectedModel: CloudModelId;
  createdAt: string;
  updatedAt: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  contentKo: string;
  runId: string | null;
  createdAt: string;
};

export type RunRecord = {
  id: string;
  taskId: string;
  conversationId: string;
  messageId: string;
  status: RunStatus;
  provider: ProviderId;
  model: CloudModelId;
  mode: OptimizationMode;
  startedAt: string;
  endedAt: string | null;
  errorCode: string | null;
};

export type RunStageRecord = {
  id: string;
  runId: string;
  stage: RunStageName;
  status: RunStageStatus;
  startedAt: string;
  endedAt: string | null;
  details: JsonObject | null;
};

export type PromptArtifactRecord = {
  id: string;
  runId: string;
  artifactType: PromptArtifactType;
  content: string;
  tokenEstimate: number | null;
  visibility: ArtifactVisibility;
};

export type UsageRecord = {
  id: string;
  runId: string;
  baselineInputTokens: number;
  optimizedInputTokens: number;
  outputTokens: number;
  estimatedCostWithoutOptimization: number;
  estimatedCostWithOptimization: number;
  pricingVersion: string;
  latencyMs: number;
};

export type CreateTaskInput = TaskRecord;
export type CreateConversationInput = ConversationRecord;
export type CreateMessageInput = MessageRecord;
export type CreateRunRecordInput = RunRecord;
export type CreateRunStageInput = RunStageRecord;
export type CreatePromptArtifactInput = PromptArtifactRecord;
export type CreateUsageRecordInput = UsageRecord;

export type UpdateRunRecordStatusInput = {
  runId: string;
  status: RunStatus;
  endedAt?: string | null;
  errorCode?: string | null;
};

export type UpdateTaskActivityInput = {
  taskId: string;
  updatedAt: string;
  lastActivityAt: string;
};

export type CompleteRunWithUsageInput = {
  runId: string;
  endedAt: string;
  usageRecord: CreateUsageRecordInput;
  taskUpdatedAt?: string;
  taskLastActivityAt?: string;
};

export interface TaskRepository {
  create(input: CreateTaskInput): Promise<TaskRecord>;
  getById(taskId: string): Promise<TaskRecord | null>;
  updateActivity(input: UpdateTaskActivityInput): Promise<TaskRecord | null>;
}

export interface ConversationRepository {
  create(input: CreateConversationInput): Promise<ConversationRecord>;
  getById(conversationId: string): Promise<ConversationRecord | null>;
}

export interface MessageRepository {
  create(input: CreateMessageInput): Promise<MessageRecord>;
  getById(messageId: string): Promise<MessageRecord | null>;
  listByConversation(conversationId: string): Promise<MessageRecord[]>;
}

export interface RunRecordRepository {
  create(input: CreateRunRecordInput): Promise<RunRecord>;
  getById(runId: string): Promise<RunRecord | null>;
  listByConversation(conversationId: string): Promise<RunRecord[]>;
  updateStatus(input: UpdateRunRecordStatusInput): Promise<RunRecord | null>;
}

export interface RunStageRepository {
  create(input: CreateRunStageInput): Promise<RunStageRecord>;
  listByRunId(runId: string): Promise<RunStageRecord[]>;
}

export interface PromptArtifactRepository {
  create(input: CreatePromptArtifactInput): Promise<PromptArtifactRecord>;
  listByRunId(runId: string): Promise<PromptArtifactRecord[]>;
}

export interface UsageRecordRepository {
  create(input: CreateUsageRecordInput): Promise<UsageRecord>;
  getByRunId(runId: string): Promise<UsageRecord | null>;
}

export interface ChatRunPersistenceScope {
  tasks: TaskRepository;
  conversations: ConversationRepository;
  messages: MessageRepository;
  runRecords: RunRecordRepository;
  runStages: RunStageRepository;
  promptArtifacts: PromptArtifactRepository;
  usageRecords: UsageRecordRepository;
}

export interface ChatRunPersistence extends ChatRunPersistenceScope {
  connection: SqliteConnection;
  close(): Promise<void>;
  transaction<T>(work: (scope: ChatRunPersistenceScope) => Promise<T> | T): Promise<T>;
  completeRunWithUsage(input: CompleteRunWithUsageInput): Promise<{
    runRecord: RunRecord;
    usageRecord: UsageRecord;
  }>;
}
