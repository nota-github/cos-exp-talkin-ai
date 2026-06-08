import { AsyncLocalStorage } from 'node:async_hooks';
import type { SqliteConnection } from './database';
import type {
  ChatRunPersistence,
  ChatRunPersistenceScope,
  CompleteRunWithUsageInput,
  ConversationRecord,
  CreateConversationInput,
  CreateMessageInput,
  CreatePromptArtifactInput,
  CreateRunRecordInput,
  CreateRunStageInput,
  CreateTaskInput,
  CreateUsageRecordInput,
  JsonObject,
  MessageRecord,
  PromptArtifactRecord,
  RunRecord,
  RunStageRecord,
  TaskRecord,
  UsageRecord,
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
