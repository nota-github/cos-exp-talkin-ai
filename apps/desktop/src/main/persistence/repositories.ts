import { AsyncLocalStorage } from 'node:async_hooks';
import type { SqliteConnection } from './database';
import {
  taskStatuses,
  type BoardColumnRecord,
  type ChatRunPersistence,
  type ChatRunPersistenceScope,
  type CompleteRunWithUsageInput,
  type ConversationRecord,
  type CreateConversationInput,
  type CreateFileAssetInput,
  type CreateMessageInput,
  type CreateProjectInput,
  type CreatePromptArtifactInput,
  type CreateRunRecordInput,
  type CreateRunStageInput,
  type CreateTaskInput,
  type CreateUsageRecordInput,
  type CreateWorkbenchLayoutInput,
  type FileAssetRecord,
  type JsonObject,
  type MessageRecord,
  type ProjectDetailRecord,
  type ProjectListItem,
  type ProjectRecord,
  type ProjectTaskRecord,
  type PromptArtifactRecord,
  type RecentTaskRecord,
  type RunRecord,
  type RunStageRecord,
  type SaveWorkbenchPanelInput,
  type TaskRecord,
  type UpdateConversationInput,
  type UsageRecord,
  type WorkbenchLayoutDetail,
  type WorkbenchLayoutRecord,
  type WorkbenchPanelRecord,
} from './types';

type TaskRow = {
  id: string;
  title: string;
  status: TaskRecord['status'];
  project_id: string | null;
  source_screen: TaskRecord['sourceScreen'];
  usage_category: TaskRecord['usageCategory'];
  created_at: string;
  updated_at: string;
  last_activity_at: string;
};

type ConversationRow = {
  id: string;
  task_id: string;
  summary: string | null;
  mode: ConversationRecord['mode'];
  selected_model: ConversationRecord['selectedModel'];
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRecord['role'];
  content_ko: string;
  run_id: string | null;
  created_at: string;
};

type RunRecordRow = {
  id: string;
  task_id: string;
  conversation_id: string;
  message_id: string;
  status: RunRecord['status'];
  provider: RunRecord['provider'];
  model: RunRecord['model'];
  mode: RunRecord['mode'];
  started_at: string;
  ended_at: string | null;
  error_code: string | null;
};

type RunStageRow = {
  id: string;
  run_id: string;
  stage: RunStageRecord['stage'];
  status: RunStageRecord['status'];
  started_at: string;
  ended_at: string | null;
  details_json: string | null;
};

type PromptArtifactRow = {
  id: string;
  run_id: string;
  artifact_type: PromptArtifactRecord['artifactType'];
  content: string;
  token_estimate: number | null;
  visibility: PromptArtifactRecord['visibility'];
};

type UsageRecordRow = {
  id: string;
  run_id: string;
  baseline_input_tokens: number;
  optimized_input_tokens: number;
  output_tokens: number;
  estimated_cost_without_optimization: number;
  estimated_cost_with_optimization: number;
  pricing_version: string;
  latency_ms: number;
  is_estimated: number;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  goal: string;
  created_at: string;
  updated_at: string;
};

type ProjectListRow = ProjectRow & {
  task_count: number;
  file_asset_count: number;
  last_task_activity_at: string | null;
};

type ProjectTaskRow = {
  task_id: string;
  title: string;
  status: TaskRecord['status'];
  last_activity_at: string;
};

type WorkbenchLayoutRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type WorkbenchPanelRow = {
  id: string;
  layout_id: string;
  panel_slot: WorkbenchPanelRecord['panelSlot'];
  task_id: string | null;
  pinned: number;
  updated_at: string;
};

type FileAssetRow = {
  id: string;
  project_id: string;
  display_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
};

type RecentTaskRow = {
  task_id: string;
  title: string;
  status: TaskRecord['status'];
  project_id: string | null;
  project_name: string | null;
  source_screen: TaskRecord['sourceScreen'];
  last_activity_at: string;
};

type BoardCardRow = {
  task_id: string;
  title: string;
  status: TaskRecord['status'];
  project_id: string | null;
  project_name: string | null;
  last_activity_at: string;
  conversation_id: string | null;
  selected_model: ConversationRecord['selectedModel'] | null;
  mode: ConversationRecord['mode'] | null;
};

type SqlPrimitive = string | number | null;

function sqlValue(value: SqlPrimitive): string {
  if (value === null) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot store non-finite number in SQLite: ${value}`);
    }

    return String(value);
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function sqlJson(value: JsonObject | null): string {
  if (!value) {
    return 'NULL';
  }

  return sqlValue(JSON.stringify(value));
}

function firstOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

function toCount(value: number | string): number {
  return Number(value);
}

function normalizedLimit(limit?: number): number {
  if (limit === undefined) {
    return 12;
  }

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Expected a positive integer task limit, received: ${limit}`);
  }

  return limit;
}

function panelSlotOrderSql(columnName: string): string {
  return `CASE ${columnName}
    WHEN 'north-west' THEN 0
    WHEN 'north-east' THEN 1
    WHEN 'south-west' THEN 2
    WHEN 'south-east' THEN 3
    ELSE 4
  END`;
}

function taskStatusOrderSql(columnName: string): string {
  return `CASE ${columnName}
    WHEN 'planning' THEN 0
    WHEN 'in_progress' THEN 1
    WHEN 'ai_review' THEN 2
    WHEN 'human_review' THEN 3
    WHEN 'completed' THEN 4
    ELSE 5
  END`;
}

function maxIsoTimestamp(base: string, candidates: string[]): string {
  return candidates.reduce((latest, candidate) => (candidate > latest ? candidate : latest), base);
}

function mapTaskRow(row: TaskRow | null): TaskRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    sourceScreen: row.source_screen,
    usageCategory: row.usage_category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

function mapConversationRow(row: ConversationRow | null): ConversationRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    taskId: row.task_id,
    summary: row.summary,
    mode: row.mode,
    selectedModel: row.selected_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: MessageRow | null): MessageRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    contentKo: row.content_ko,
    runId: row.run_id,
    createdAt: row.created_at,
  };
}

function mapRunRecordRow(row: RunRecordRow | null): RunRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    taskId: row.task_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    mode: row.mode,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    errorCode: row.error_code,
  };
}

function mapRunStageRow(row: RunStageRow | null): RunStageRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    details: row.details_json ? (JSON.parse(row.details_json) as JsonObject) : null,
  };
}

function mapPromptArtifactRow(row: PromptArtifactRow | null): PromptArtifactRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    runId: row.run_id,
    artifactType: row.artifact_type,
    content: row.content,
    tokenEstimate: row.token_estimate,
    visibility: row.visibility,
  };
}

function mapUsageRecordRow(row: UsageRecordRow | null): UsageRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    runId: row.run_id,
    baselineInputTokens: row.baseline_input_tokens,
    optimizedInputTokens: row.optimized_input_tokens,
    outputTokens: row.output_tokens,
    estimatedCostWithoutOptimization: row.estimated_cost_without_optimization,
    estimatedCostWithOptimization: row.estimated_cost_with_optimization,
    pricingVersion: row.pricing_version,
    latencyMs: row.latency_ms,
    isEstimated: row.is_estimated === 1,
  };
}

function mapProjectRow(row: ProjectRow | null): ProjectRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectListRow(row: ProjectListRow): ProjectListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: toCount(row.task_count),
    fileAssetCount: toCount(row.file_asset_count),
    lastTaskActivityAt: row.last_task_activity_at,
  };
}

function mapProjectTaskRow(row: ProjectTaskRow): ProjectTaskRecord {
  return {
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    lastActivityAt: row.last_activity_at,
  };
}

function mapWorkbenchLayoutRow(row: WorkbenchLayoutRow | null): WorkbenchLayoutRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkbenchPanelRow(row: WorkbenchPanelRow | null): WorkbenchPanelRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    layoutId: row.layout_id,
    panelSlot: row.panel_slot,
    taskId: row.task_id,
    pinned: row.pinned === 1,
    updatedAt: row.updated_at,
  };
}

function mapFileAssetRow(row: FileAssetRow | null): FileAssetRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    displayName: row.display_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
  };
}

function mapRecentTaskRow(row: RecentTaskRow): RecentTaskRecord {
  return {
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    projectName: row.project_name,
    sourceScreen: row.source_screen,
    lastActivityAt: row.last_activity_at,
  };
}

function mapBoardCardRow(row: BoardCardRow) {
  return {
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    projectId: row.project_id,
    projectName: row.project_name,
    lastActivityAt: row.last_activity_at,
    conversationId: row.conversation_id,
    selectedModel: row.selected_model,
    mode: row.mode,
  };
}

async function listWorkbenchPanelsByLayout(
  connection: SqliteConnection,
  layoutId: string,
): Promise<WorkbenchPanelRecord[]> {
  const rows = await connection.query<WorkbenchPanelRow>(`
    SELECT *
    FROM workbench_panels
    WHERE layout_id = ${sqlValue(layoutId)}
    ORDER BY ${panelSlotOrderSql('panel_slot')} ASC;
  `);

  return rows.map((row) => mapWorkbenchPanelRow(row) as WorkbenchPanelRecord);
}

async function listFileAssetsByProject(
  connection: SqliteConnection,
  projectId: string,
): Promise<FileAssetRecord[]> {
  const rows = await connection.query<FileAssetRow>(`
    SELECT *
    FROM file_assets
    WHERE project_id = ${sqlValue(projectId)}
    ORDER BY display_name ASC, rowid ASC;
  `);

  return rows.map((row) => mapFileAssetRow(row) as FileAssetRecord);
}

function createScope(connection: SqliteConnection): ChatRunPersistenceScope {
  return {
    tasks: {
      async create(input: CreateTaskInput) {
        await connection.exec(`
          INSERT INTO tasks (
            id,
            title,
            status,
            project_id,
            source_screen,
            usage_category,
            created_at,
            updated_at,
            last_activity_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.title)},
            ${sqlValue(input.status)},
            ${sqlValue(input.projectId)},
            ${sqlValue(input.sourceScreen)},
            ${sqlValue(input.usageCategory)},
            ${sqlValue(input.createdAt)},
            ${sqlValue(input.updatedAt)},
            ${sqlValue(input.lastActivityAt)}
          );
        `);

        return (await this.getById(input.id)) as TaskRecord;
      },

      async getById(taskId: string) {
        const rows = await connection.query<TaskRow>(`
          SELECT *
          FROM tasks
          WHERE id = ${sqlValue(taskId)}
          LIMIT 1;
        `);

        return mapTaskRow(firstOrNull(rows));
      },

      async updateActivity(input) {
        await connection.exec(`
          UPDATE tasks
          SET updated_at = ${sqlValue(input.updatedAt)},
              last_activity_at = ${sqlValue(input.lastActivityAt)}
          WHERE id = ${sqlValue(input.taskId)};
        `);

        return this.getById(input.taskId);
      },

      async updateWorkflow(input) {
        if (input.status === undefined && input.projectId === undefined) {
          throw new Error('Expected status or projectId when updating canonical task workflow state');
        }

        const assignments = [`updated_at = ${sqlValue(input.updatedAt)}`];

        if (input.status !== undefined) {
          assignments.push(`status = ${sqlValue(input.status)}`);
        }

        if (input.projectId !== undefined) {
          assignments.push(`project_id = ${sqlValue(input.projectId)}`);
        }

        assignments.push(`last_activity_at = ${sqlValue(input.lastActivityAt ?? input.updatedAt)}`);

        await connection.exec(`
          UPDATE tasks
          SET ${assignments.join(',\n              ')}
          WHERE id = ${sqlValue(input.taskId)};
        `);

        return this.getById(input.taskId);
      },

      async listRecent(limit) {
        const rows = await connection.query<RecentTaskRow>(`
          SELECT
            t.id AS task_id,
            t.title,
            t.status,
            t.project_id,
            p.name AS project_name,
            t.source_screen,
            t.last_activity_at
          FROM tasks t
          LEFT JOIN projects p ON p.id = t.project_id
          ORDER BY t.last_activity_at DESC, t.updated_at DESC
          LIMIT ${sqlValue(normalizedLimit(limit))};
        `);

        return rows.map((row) => mapRecentTaskRow(row));
      },
    },

    conversations: {
      async create(input: CreateConversationInput) {
        await connection.exec(`
          INSERT INTO conversations (
            id,
            task_id,
            summary,
            mode,
            selected_model,
            created_at,
            updated_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.taskId)},
            ${sqlValue(input.summary)},
            ${sqlValue(input.mode)},
            ${sqlValue(input.selectedModel)},
            ${sqlValue(input.createdAt)},
            ${sqlValue(input.updatedAt)}
          );
        `);

        return (await this.getById(input.id)) as ConversationRecord;
      },

      async getById(conversationId: string) {
        const rows = await connection.query<ConversationRow>(`
          SELECT *
          FROM conversations
          WHERE id = ${sqlValue(conversationId)}
          LIMIT 1;
        `);

        return mapConversationRow(firstOrNull(rows));
      },

      async update(input: UpdateConversationInput) {
        await connection.exec(`
          UPDATE conversations
          SET summary = ${sqlValue(input.summary ?? null)},
              mode = ${sqlValue(input.mode ?? null)},
              selected_model = ${sqlValue(input.selectedModel ?? null)},
              updated_at = ${sqlValue(input.updatedAt)}
          WHERE id = ${sqlValue(input.conversationId)};
        `);

        return this.getById(input.conversationId);
      },
    },

    messages: {
      async create(input: CreateMessageInput) {
        await connection.exec(`
          INSERT INTO messages (
            id,
            conversation_id,
            role,
            content_ko,
            run_id,
            created_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.conversationId)},
            ${sqlValue(input.role)},
            ${sqlValue(input.contentKo)},
            ${sqlValue(input.runId)},
            ${sqlValue(input.createdAt)}
          );
        `);

        return (await this.getById(input.id)) as MessageRecord;
      },

      async getById(messageId: string) {
        const rows = await connection.query<MessageRow>(`
          SELECT *
          FROM messages
          WHERE id = ${sqlValue(messageId)}
          LIMIT 1;
        `);

        return mapMessageRow(firstOrNull(rows));
      },

      async listByConversation(conversationId: string) {
        const rows = await connection.query<MessageRow>(`
          SELECT *
          FROM messages
          WHERE conversation_id = ${sqlValue(conversationId)}
          ORDER BY created_at ASC;
        `);

        return rows.map((row) => mapMessageRow(row) as MessageRecord);
      },
    },

    runRecords: {
      async create(input: CreateRunRecordInput) {
        await connection.exec(`
          INSERT INTO run_records (
            id,
            task_id,
            conversation_id,
            message_id,
            status,
            provider,
            model,
            mode,
            started_at,
            ended_at,
            error_code
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.taskId)},
            ${sqlValue(input.conversationId)},
            ${sqlValue(input.messageId)},
            ${sqlValue(input.status)},
            ${sqlValue(input.provider)},
            ${sqlValue(input.model)},
            ${sqlValue(input.mode)},
            ${sqlValue(input.startedAt)},
            ${sqlValue(input.endedAt)},
            ${sqlValue(input.errorCode)}
          );
        `);

        return (await this.getById(input.id)) as RunRecord;
      },

      async getById(runId: string) {
        const rows = await connection.query<RunRecordRow>(`
          SELECT *
          FROM run_records
          WHERE id = ${sqlValue(runId)}
          LIMIT 1;
        `);

        return mapRunRecordRow(firstOrNull(rows));
      },

      async listByConversation(conversationId: string) {
        const rows = await connection.query<RunRecordRow>(`
          SELECT *
          FROM run_records
          WHERE conversation_id = ${sqlValue(conversationId)}
          ORDER BY started_at ASC;
        `);

        return rows.map((row) => mapRunRecordRow(row) as RunRecord);
      },

      async updateStatus(input) {
        await connection.exec(`
          UPDATE run_records
          SET status = ${sqlValue(input.status)},
              ended_at = ${sqlValue(input.endedAt ?? null)},
              error_code = ${sqlValue(input.errorCode ?? null)}
          WHERE id = ${sqlValue(input.runId)};
        `);

        return this.getById(input.runId);
      },
    },

    runStages: {
      async create(input: CreateRunStageInput) {
        await connection.exec(`
          INSERT INTO run_stages (
            id,
            run_id,
            stage,
            status,
            started_at,
            ended_at,
            details_json
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.runId)},
            ${sqlValue(input.stage)},
            ${sqlValue(input.status)},
            ${sqlValue(input.startedAt)},
            ${sqlValue(input.endedAt)},
            ${sqlJson(input.details)}
          );
        `);

        const records = await this.listByRunId(input.runId);
        return records.at(-1) as RunStageRecord;
      },

      async listByRunId(runId: string) {
        const rows = await connection.query<RunStageRow>(`
          SELECT *
          FROM run_stages
          WHERE run_id = ${sqlValue(runId)}
          ORDER BY started_at ASC;
        `);

        return rows.map((row) => mapRunStageRow(row) as RunStageRecord);
      },
    },

    promptArtifacts: {
      async create(input: CreatePromptArtifactInput) {
        await connection.exec(`
          INSERT INTO prompt_artifacts (
            id,
            run_id,
            artifact_type,
            content,
            token_estimate,
            visibility
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.runId)},
            ${sqlValue(input.artifactType)},
            ${sqlValue(input.content)},
            ${sqlValue(input.tokenEstimate)},
            ${sqlValue(input.visibility)}
          );
        `);

        const artifacts = await this.listByRunId(input.runId);
        return artifacts.find((artifact) => artifact.id === input.id) as PromptArtifactRecord;
      },

      async listByRunId(runId: string) {
        const rows = await connection.query<PromptArtifactRow>(`
          SELECT *
          FROM prompt_artifacts
          WHERE run_id = ${sqlValue(runId)}
          ORDER BY rowid ASC;
        `);

        return rows.map((row) => mapPromptArtifactRow(row) as PromptArtifactRecord);
      },
    },

    usageRecords: {
      async create(input: CreateUsageRecordInput) {
        await connection.exec(`
          INSERT INTO usage_records (
            id,
            run_id,
            baseline_input_tokens,
            optimized_input_tokens,
            output_tokens,
            estimated_cost_without_optimization,
            estimated_cost_with_optimization,
            pricing_version,
            latency_ms,
            is_estimated
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.runId)},
            ${sqlValue(input.baselineInputTokens)},
            ${sqlValue(input.optimizedInputTokens)},
            ${sqlValue(input.outputTokens)},
            ${sqlValue(input.estimatedCostWithoutOptimization)},
            ${sqlValue(input.estimatedCostWithOptimization)},
            ${sqlValue(input.pricingVersion)},
            ${sqlValue(input.latencyMs)},
            ${sqlValue(input.isEstimated ? 1 : 0)}
          );
        `);

        return (await this.getByRunId(input.runId)) as UsageRecord;
      },

      async getByRunId(runId: string) {
        const rows = await connection.query<UsageRecordRow>(`
          SELECT *
          FROM usage_records
          WHERE run_id = ${sqlValue(runId)}
          LIMIT 1;
        `);

        return mapUsageRecordRow(firstOrNull(rows));
      },
    },

    projects: {
      async create(input: CreateProjectInput) {
        await connection.exec(`
          INSERT INTO projects (
            id,
            name,
            description,
            goal,
            created_at,
            updated_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.name)},
            ${sqlValue(input.description)},
            ${sqlValue(input.goal)},
            ${sqlValue(input.createdAt)},
            ${sqlValue(input.updatedAt)}
          );
        `);

        return (await this.getById(input.id)) as ProjectRecord;
      },

      async getById(projectId: string) {
        const rows = await connection.query<ProjectRow>(`
          SELECT *
          FROM projects
          WHERE id = ${sqlValue(projectId)}
          LIMIT 1;
        `);

        return mapProjectRow(firstOrNull(rows));
      },

      async list() {
        const rows = await connection.query<ProjectListRow>(`
          SELECT
            p.id,
            p.name,
            p.description,
            p.goal,
            p.created_at,
            p.updated_at,
            COUNT(DISTINCT t.id) AS task_count,
            COUNT(DISTINCT f.id) AS file_asset_count,
            MAX(t.last_activity_at) AS last_task_activity_at
          FROM projects p
          LEFT JOIN tasks t ON t.project_id = p.id
          LEFT JOIN file_assets f ON f.project_id = p.id
          GROUP BY p.id
          ORDER BY COALESCE(MAX(t.last_activity_at), p.updated_at) DESC, p.updated_at DESC;
        `);

        return rows.map((row) => mapProjectListRow(row));
      },

      async getDetail(projectId: string) {
        const project = await this.getById(projectId);
        if (!project) {
          return null;
        }

        const taskRows = await connection.query<ProjectTaskRow>(`
          SELECT
            id AS task_id,
            title,
            status,
            last_activity_at
          FROM tasks
          WHERE project_id = ${sqlValue(projectId)}
          ORDER BY last_activity_at DESC, updated_at DESC;
        `);

        return {
          ...project,
          tasks: taskRows.map((row) => mapProjectTaskRow(row)),
          fileAssets: await listFileAssetsByProject(connection, projectId),
        } satisfies ProjectDetailRecord;
      },
    },

    workbenchLayouts: {
      async create(input: CreateWorkbenchLayoutInput) {
        await connection.exec(`
          INSERT INTO workbench_layouts (
            id,
            name,
            created_at,
            updated_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.name)},
            ${sqlValue(input.createdAt)},
            ${sqlValue(input.updatedAt)}
          );
        `);

        return (await this.getById(input.id)) as WorkbenchLayoutRecord;
      },

      async getById(layoutId: string) {
        const rows = await connection.query<WorkbenchLayoutRow>(`
          SELECT *
          FROM workbench_layouts
          WHERE id = ${sqlValue(layoutId)}
          LIMIT 1;
        `);

        return mapWorkbenchLayoutRow(firstOrNull(rows));
      },

      async list() {
        const rows = await connection.query<WorkbenchLayoutRow>(`
          SELECT *
          FROM workbench_layouts
          ORDER BY updated_at DESC, created_at DESC;
        `);

        return rows.map((row) => mapWorkbenchLayoutRow(row) as WorkbenchLayoutRecord);
      },

      async getDetail(layoutId: string) {
        const layout = await this.getById(layoutId);
        if (!layout) {
          return null;
        }

        const panels = await listWorkbenchPanelsByLayout(connection, layoutId);
        const effectiveUpdatedAt = panels.length
          ? maxIsoTimestamp(
              layout.updatedAt,
              panels.map((panel) => panel.updatedAt),
            )
          : layout.updatedAt;

        return {
          layout: {
            ...layout,
            updatedAt: effectiveUpdatedAt,
          },
          panels,
        } satisfies WorkbenchLayoutDetail;
      },
    },

    workbenchPanels: {
      async save(input: SaveWorkbenchPanelInput) {
        if (input.taskId !== null) {
          await connection.exec(`
            UPDATE workbench_panels
            SET task_id = NULL,
                pinned = 0,
                updated_at = ${sqlValue(input.updatedAt)}
            WHERE layout_id = ${sqlValue(input.layoutId)}
              AND task_id = ${sqlValue(input.taskId)}
              AND panel_slot <> ${sqlValue(input.panelSlot)};
          `);
        }

        await connection.exec(`
          INSERT INTO workbench_panels (
            id,
            layout_id,
            panel_slot,
            task_id,
            pinned,
            updated_at
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.layoutId)},
            ${sqlValue(input.panelSlot)},
            ${sqlValue(input.taskId)},
            ${sqlValue(input.pinned ? 1 : 0)},
            ${sqlValue(input.updatedAt)}
          )
          ON CONFLICT(layout_id, panel_slot) DO UPDATE SET
            task_id = excluded.task_id,
            pinned = excluded.pinned,
            updated_at = excluded.updated_at;
        `);

        return (await this.getBySlot(input.layoutId, input.panelSlot)) as WorkbenchPanelRecord;
      },

      async getBySlot(layoutId: string, panelSlot: WorkbenchPanelRecord['panelSlot']) {
        const rows = await connection.query<WorkbenchPanelRow>(`
          SELECT *
          FROM workbench_panels
          WHERE layout_id = ${sqlValue(layoutId)}
            AND panel_slot = ${sqlValue(panelSlot)}
          LIMIT 1;
        `);

        return mapWorkbenchPanelRow(firstOrNull(rows));
      },

      async getByTask(layoutId: string, taskId: string) {
        const rows = await connection.query<WorkbenchPanelRow>(`
          SELECT *
          FROM workbench_panels
          WHERE layout_id = ${sqlValue(layoutId)}
            AND task_id = ${sqlValue(taskId)}
          LIMIT 1;
        `);

        return mapWorkbenchPanelRow(firstOrNull(rows));
      },

      async listByLayout(layoutId: string) {
        return listWorkbenchPanelsByLayout(connection, layoutId);
      },
    },

    fileAssets: {
      async create(input: CreateFileAssetInput) {
        await connection.exec(`
          INSERT INTO file_assets (
            id,
            project_id,
            display_name,
            storage_path,
            mime_type,
            size_bytes
          ) VALUES (
            ${sqlValue(input.id)},
            ${sqlValue(input.projectId)},
            ${sqlValue(input.displayName)},
            ${sqlValue(input.storagePath)},
            ${sqlValue(input.mimeType)},
            ${sqlValue(input.sizeBytes)}
          );
        `);

        return (await this.getById(input.id)) as FileAssetRecord;
      },

      async getById(fileAssetId: string) {
        const rows = await connection.query<FileAssetRow>(`
          SELECT *
          FROM file_assets
          WHERE id = ${sqlValue(fileAssetId)}
          LIMIT 1;
        `);

        return mapFileAssetRow(firstOrNull(rows));
      },

      async update(input) {
        await connection.exec(`
          UPDATE file_assets
          SET project_id = ${sqlValue(input.projectId)},
              display_name = ${sqlValue(input.displayName)},
              storage_path = ${sqlValue(input.storagePath)},
              mime_type = ${sqlValue(input.mimeType)},
              size_bytes = ${sqlValue(input.sizeBytes)}
          WHERE id = ${sqlValue(input.id)};
        `);

        return this.getById(input.id);
      },

      async delete(fileAssetId: string) {
        await connection.exec(`
          DELETE FROM file_assets
          WHERE id = ${sqlValue(fileAssetId)};
        `);
      },

      async listByProject(projectId: string) {
        return listFileAssetsByProject(connection, projectId);
      },
    },

    board: {
      async getColumns() {
        const rows = await connection.query<BoardCardRow>(`
          SELECT
            t.id AS task_id,
            t.title,
            t.status,
            t.project_id,
            p.name AS project_name,
            t.last_activity_at,
            c.id AS conversation_id,
            c.selected_model AS selected_model,
            c.mode AS mode
          FROM tasks t
          LEFT JOIN projects p ON p.id = t.project_id
          LEFT JOIN conversations c
            ON c.id = (
              SELECT candidate.id
              FROM conversations AS candidate
              WHERE candidate.task_id = t.id
              ORDER BY candidate.created_at DESC
              LIMIT 1
            )
          ORDER BY ${taskStatusOrderSql('t.status')} ASC, t.last_activity_at DESC;
        `);

        const cardsByStatus = new Map<TaskRecord['status'], ReturnType<typeof mapBoardCardRow>[]>(
          taskStatuses.map((status) => [status, []]),
        );

        for (const row of rows) {
          cardsByStatus.get(row.status)?.push(mapBoardCardRow(row));
        }

        return taskStatuses.map(
          (status) =>
            ({
              status,
              cards: cardsByStatus.get(status) ?? [],
            }) satisfies BoardColumnRecord,
        );
      },
    },
  };
}

function gateRepository<T extends object>(
  repository: T,
  gate: <TResult>(operation: () => Promise<TResult> | TResult) => Promise<TResult>,
): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return (...args: unknown[]) =>
        gate(() => Reflect.apply(value, target, args) as Promise<unknown>);
    },
  });
}

function gateScope(
  scope: ChatRunPersistenceScope,
  gate: <TResult>(operation: () => Promise<TResult> | TResult) => Promise<TResult>,
): ChatRunPersistenceScope {
  return {
    tasks: gateRepository(scope.tasks, gate),
    conversations: gateRepository(scope.conversations, gate),
    messages: gateRepository(scope.messages, gate),
    runRecords: gateRepository(scope.runRecords, gate),
    runStages: gateRepository(scope.runStages, gate),
    promptArtifacts: gateRepository(scope.promptArtifacts, gate),
    usageRecords: gateRepository(scope.usageRecords, gate),
    projects: gateRepository(scope.projects, gate),
    workbenchLayouts: gateRepository(scope.workbenchLayouts, gate),
    workbenchPanels: gateRepository(scope.workbenchPanels, gate),
    fileAssets: gateRepository(scope.fileAssets, gate),
    board: gateRepository(scope.board, gate),
  };
}

export function createChatRunPersistence(connection: SqliteConnection): ChatRunPersistence {
  const rawScope = createScope(connection);
  let topLevelTransactionChain: Promise<void> = Promise.resolve();
  const transactionContext = new AsyncLocalStorage<{ depth: number }>();

  async function runOnSharedConnection<T>(
    operation: () => Promise<T> | T,
  ): Promise<T> {
    if (transactionContext.getStore()) {
      return operation();
    }

    const runWhenReady = async () => operation();
    const pendingTopLevel = topLevelTransactionChain.then(runWhenReady, runWhenReady);

    topLevelTransactionChain = pendingTopLevel.then(
      () => undefined,
      () => undefined,
    );

    return pendingTopLevel;
  }

  const scope = gateScope(rawScope, runOnSharedConnection);

  async function runTransactionScope<T>(
    depth: number,
    work: (scope: ChatRunPersistenceScope) => Promise<T> | T,
  ): Promise<T> {
    const isTopLevel = depth === 0;
    const savepointName = `talkin_ai_tx_${depth + 1}`;

    if (isTopLevel) {
      await connection.exec('BEGIN IMMEDIATE;');
    } else {
      await connection.exec(`SAVEPOINT ${savepointName};`);
    }

    try {
      const result = await transactionContext.run({ depth: depth + 1 }, () => work(rawScope));

      if (isTopLevel) {
        await connection.exec('COMMIT;');
      } else {
        await connection.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }

      return result;
    } catch (error) {
      if (isTopLevel) {
        await connection.exec('ROLLBACK;');
      } else {
        await connection.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
        await connection.exec(`RELEASE SAVEPOINT ${savepointName};`);
      }

      throw error;
    }
  }

  async function transaction<T>(work: (scope: ChatRunPersistenceScope) => Promise<T> | T): Promise<T> {
    const activeContext = transactionContext.getStore();
    if (activeContext) {
      return runTransactionScope(activeContext.depth, work);
    }

    return runOnSharedConnection(() => runTransactionScope(0, work));
  }

  async function completeRunWithUsage(input: CompleteRunWithUsageInput) {
    if (input.usageRecord.runId !== input.runId) {
      throw new Error('Usage record runId must match the completed run id');
    }

    return transaction(async (tx) => {
      const runRecord = await tx.runRecords.updateStatus({
        runId: input.runId,
        status: 'completed',
        endedAt: input.endedAt,
        errorCode: null,
      });

      if (!runRecord) {
        throw new Error(`Run record ${input.runId} does not exist`);
      }

      await tx.tasks.updateActivity({
        taskId: runRecord.taskId,
        updatedAt: input.taskUpdatedAt ?? input.endedAt,
        lastActivityAt: input.taskLastActivityAt ?? input.endedAt,
      });

      const usageRecord = await tx.usageRecords.create(input.usageRecord);

      return {
        runRecord,
        usageRecord,
      };
    });
  }

  return {
    connection,
    ...scope,
    close() {
      return connection.close();
    },
    transaction,
    completeRunWithUsage,
  };
}
