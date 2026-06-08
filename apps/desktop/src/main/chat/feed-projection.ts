import type {
  ChatFeedMessage,
  ChatFeedRunFailureSummary,
  ChatFeedRunSummary,
  ChatFeedRunUsageSummary,
} from '../../shared/ipc/contracts';
import type { SqliteConnection } from '../persistence/database';

type SqlPrimitive = string | number | null;

type MessageRow = {
  id: string;
  conversation_id: string;
  role: ChatFeedMessage['role'];
  content_ko: string;
  run_id: string | null;
  created_at: string;
};

type RunRow = {
  id: string;
  message_id: string;
  status: ChatFeedRunSummary['status'];
  model: ChatFeedRunSummary['model'];
  mode: ChatFeedRunSummary['mode'];
  error_code: string | null;
};

type RunStageRow = {
  stage: Exclude<ChatFeedRunSummary['stage'], null>;
  details_json: string | null;
};

type UsageRow = {
  baseline_input_tokens: number;
  optimized_input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  is_estimated: number;
};

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

function parseStageDetails(detailsJson: string | null) {
  if (!detailsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(detailsJson) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function computeSavingsRate(baselineTokens: number, optimizedTokens: number) {
  if (baselineTokens <= 0) {
    return 0;
  }

  const rawRate = Math.round((1 - optimizedTokens / baselineTokens) * 100);
  return Math.max(0, rawRate);
}

function mapRunUsageSummary(row: UsageRow | undefined): ChatFeedRunUsageSummary | null {
  if (!row) {
    return null;
  }

  return {
    baselineInputTokens: row.baseline_input_tokens,
    optimizedInputTokens: row.optimized_input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    savingsRate: computeSavingsRate(row.baseline_input_tokens, row.optimized_input_tokens),
    isEstimated: row.is_estimated === 1,
  };
}

function buildFailureSummary(
  run: Pick<RunRow, 'status' | 'error_code'>,
  latestStage: RunStageRow | undefined,
): ChatFeedRunFailureSummary | null {
  if (run.status !== 'failed' || !latestStage) {
    return null;
  }

  const details = parseStageDetails(latestStage.details_json);
  const failedStage = readString(details?.stage);

  return {
    failedStage:
      failedStage === 'queued' ||
      failedStage === 'optimizing' ||
      failedStage === 'optimized' ||
      failedStage === 'cloud_pending' ||
      failedStage === 'restoring' ||
      failedStage === 'completed' ||
      failedStage === 'failed'
        ? failedStage
        : latestStage.stage,
    message: readString(details?.message),
    guidance: readString(details?.guidance),
    retryable:
      readBoolean(details?.retryable) ??
      readBoolean(details?.recoverable),
  };
}

export async function listConversationMessages(
  connection: SqliteConnection,
  conversationId: string,
): Promise<ChatFeedMessage[]> {
  const rows = await connection.query<MessageRow>(`
    SELECT
      id,
      conversation_id,
      role,
      content_ko,
      run_id,
      created_at
    FROM messages
    WHERE conversation_id = ${sqlValue(conversationId)}
    ORDER BY created_at ASC;
  `);

  return rows.map((row) => ({
    messageId: row.id,
    conversationId: row.conversation_id,
    runId: row.run_id,
    role: row.role,
    contentKo: row.content_ko,
    createdAt: row.created_at,
  }));
}

export async function listConversationRuns(
  connection: SqliteConnection,
  conversationId: string,
): Promise<ChatFeedRunSummary[]> {
  const runRows = await connection.query<RunRow>(`
    SELECT
      id,
      message_id,
      status,
      model,
      mode,
      error_code
    FROM run_records
    WHERE conversation_id = ${sqlValue(conversationId)}
    ORDER BY started_at ASC, rowid ASC;
  `);

  const summaries: ChatFeedRunSummary[] = [];

  for (const run of runRows) {
    const [latestStage] = await connection.query<RunStageRow>(`
      SELECT
        stage,
        details_json
      FROM run_stages
      WHERE run_id = ${sqlValue(run.id)}
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1;
    `);
    const [usageRow] = await connection.query<UsageRow>(`
      SELECT
        baseline_input_tokens,
        optimized_input_tokens,
        output_tokens,
        latency_ms,
        is_estimated
      FROM usage_records
      WHERE run_id = ${sqlValue(run.id)}
      LIMIT 1;
    `);

    summaries.push({
      runId: run.id,
      sourceMessageId: run.message_id,
      status: run.status,
      stage: latestStage?.stage ?? null,
      model: run.model,
      mode: run.mode,
      errorCode: run.error_code,
      failure: buildFailureSummary(run, latestStage),
      usage: mapRunUsageSummary(usageRow),
    });
  }

  return summaries;
}
