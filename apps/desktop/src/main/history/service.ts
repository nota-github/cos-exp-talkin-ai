import type {
  CloudModelId,
  HistoryEntryQuery,
  HistoryEntryResult,
  HistoryFeedItem,
  HistoryFeedQuery,
  HistoryFeedResult,
  OptimizationMode,
} from '../../shared/ipc/contracts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';

type HistoryFeedRow = {
  run_id: string;
  task_id: string;
  title: string;
  model: CloudModelId;
  mode: OptimizationMode;
  completed_at: string | null;
  final_response_ko: string | null;
  baseline_input_tokens: number;
  optimized_input_tokens: number;
};

type HistoryEntryRow = {
  run_id: string;
  task_id: string;
  title: string;
  model: CloudModelId;
  mode: OptimizationMode;
  completed_at: string | null;
  prompt_ko: string;
  optimized_prompt_en: string | null;
  optimized_prompt_tokens: number | null;
  provider_response_en: string | null;
  provider_response_tokens: number | null;
  restored_response_ko: string | null;
  restored_response_tokens: number | null;
  assistant_response_ko: string | null;
  baseline_input_tokens: number;
  optimized_input_tokens: number;
  output_tokens: number;
  estimated_cost_without_optimization: number;
  estimated_cost_with_optimization: number;
  pricing_version: string;
  is_estimated: number;
};

export interface HistoryInspectionService {
  getHistoryFeed(request: HistoryFeedQuery): Promise<HistoryFeedResult>;
  getHistoryEntry(request: HistoryEntryQuery): Promise<HistoryEntryResult>;
}

export type PersistentHistoryInspectionServiceOptions = {
  dbPath: string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
};

const restoredResponseSql = `
  SELECT content
  FROM prompt_artifacts
  WHERE run_id = run_records.id
    AND artifact_type = 'restored_response_ko'
  ORDER BY rowid DESC
  LIMIT 1
`;

const assistantResponseSql = `
  SELECT content_ko
  FROM messages
  WHERE run_id = run_records.id
    AND role = 'assistant'
  ORDER BY created_at DESC, rowid DESC
  LIMIT 1
`;

const finalResponseSql = `COALESCE((${restoredResponseSql}), (${assistantResponseSql}))`;

function computeSavingsRate(baselineTokens: number, optimizedTokens: number) {
  if (baselineTokens <= 0) {
    return 0;
  }

  const rawRate = Math.round((1 - optimizedTokens / baselineTokens) * 100);
  return Math.max(0, rawRate);
}

function collapsePreview(value: string, maxLength = 132) {
  const collapsed = value.replace(/\s+/g, ' ').trim();

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return `${collapsed.slice(0, maxLength).trimEnd()}...`;
}

function buildHistoryFeedItem(row: HistoryFeedRow): HistoryFeedItem {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    title: row.title,
    finalResponsePreview: collapsePreview(
      row.final_response_ko ?? '최종 한국어 응답이 아직 저장되지 않았습니다.',
    ),
    model: row.model,
    mode: row.mode,
    completedAt: row.completed_at,
    savingsRate: computeSavingsRate(row.baseline_input_tokens, row.optimized_input_tokens),
    tokenReduction: Math.max(0, row.baseline_input_tokens - row.optimized_input_tokens),
  };
}

async function listHistoryFeedRows(connection: SqliteConnection): Promise<HistoryFeedRow[]> {
  return connection.query<HistoryFeedRow>(`
    SELECT
      run_records.id AS run_id,
      run_records.task_id AS task_id,
      tasks.title AS title,
      run_records.model AS model,
      run_records.mode AS mode,
      run_records.ended_at AS completed_at,
      ${finalResponseSql} AS final_response_ko,
      usage_records.baseline_input_tokens AS baseline_input_tokens,
      usage_records.optimized_input_tokens AS optimized_input_tokens
    FROM run_records
    INNER JOIN tasks
      ON tasks.id = run_records.task_id
    INNER JOIN usage_records
      ON usage_records.run_id = run_records.id
    WHERE ${finalResponseSql} IS NOT NULL
    ORDER BY COALESCE(run_records.ended_at, run_records.started_at) DESC, usage_records.rowid DESC;
  `);
}

async function readHistoryEntryRow(
  connection: SqliteConnection,
  runId: string,
): Promise<HistoryEntryRow | null> {
  const rows = await connection.query<HistoryEntryRow>(`
    SELECT
      run_records.id AS run_id,
      run_records.task_id AS task_id,
      tasks.title AS title,
      run_records.model AS model,
      run_records.mode AS mode,
      run_records.ended_at AS completed_at,
      source_message.content_ko AS prompt_ko,
      (
        SELECT content
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'optimized_prompt_en'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS optimized_prompt_en,
      (
        SELECT token_estimate
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'optimized_prompt_en'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS optimized_prompt_tokens,
      (
        SELECT content
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'provider_response_en'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS provider_response_en,
      (
        SELECT token_estimate
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'provider_response_en'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS provider_response_tokens,
      (
        SELECT content
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'restored_response_ko'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS restored_response_ko,
      (
        SELECT token_estimate
        FROM prompt_artifacts
        WHERE run_id = run_records.id
          AND artifact_type = 'restored_response_ko'
        ORDER BY rowid DESC
        LIMIT 1
      ) AS restored_response_tokens,
      (${assistantResponseSql}) AS assistant_response_ko,
      usage_records.baseline_input_tokens AS baseline_input_tokens,
      usage_records.optimized_input_tokens AS optimized_input_tokens,
      usage_records.output_tokens AS output_tokens,
      usage_records.estimated_cost_without_optimization AS estimated_cost_without_optimization,
      usage_records.estimated_cost_with_optimization AS estimated_cost_with_optimization,
      usage_records.pricing_version AS pricing_version,
      usage_records.is_estimated AS is_estimated
    FROM run_records
    INNER JOIN tasks
      ON tasks.id = run_records.task_id
    INNER JOIN messages AS source_message
      ON source_message.id = run_records.message_id
    INNER JOIN usage_records
      ON usage_records.run_id = run_records.id
    WHERE run_records.id = '${runId.replace(/'/g, "''")}'
    LIMIT 1;
  `);

  return rows[0] ?? null;
}

function mapHistoryEntry(row: HistoryEntryRow): HistoryEntryResult {
  const finalResponseContent = row.restored_response_ko ?? row.assistant_response_ko ?? '';

  return {
    runId: row.run_id,
    taskId: row.task_id,
    title: row.title,
    model: row.model,
    mode: row.mode,
    completedAt: row.completed_at,
    sourcePromptKo: {
      content: row.prompt_ko,
      tokenEstimate: row.baseline_input_tokens,
    },
    optimizedPromptEn: row.optimized_prompt_en
      ? {
          content: row.optimized_prompt_en,
          tokenEstimate: row.optimized_prompt_tokens ?? row.optimized_input_tokens,
        }
      : null,
    providerResponseEn: row.provider_response_en
      ? {
          content: row.provider_response_en,
          tokenEstimate: row.provider_response_tokens ?? row.output_tokens,
        }
      : null,
    finalResponseKo: {
      content: finalResponseContent,
      tokenEstimate: row.restored_response_tokens,
    },
    usage: {
      baselineInputTokens: row.baseline_input_tokens,
      optimizedInputTokens: row.optimized_input_tokens,
      outputTokens: row.output_tokens,
      tokenReduction: Math.max(0, row.baseline_input_tokens - row.optimized_input_tokens),
      savingsRate: computeSavingsRate(row.baseline_input_tokens, row.optimized_input_tokens),
      estimatedSavingsUsd: Number(
        (
          row.estimated_cost_without_optimization -
          row.estimated_cost_with_optimization
        ).toFixed(6),
      ),
      pricingVersion: row.pricing_version,
      isEstimated: row.is_estimated === 1,
    },
  };
}

async function withHistoryDatabase<TValue>(
  options: PersistentHistoryInspectionServiceOptions,
  work: (connection: SqliteConnection) => Promise<TValue>,
) {
  const openDatabase = options.openDatabase ?? openSqliteDatabase;
  const migrateSchema = options.migrateSchema ?? migrateDesktopSchema;
  const handle = await openDatabase(options.dbPath);

  try {
    await migrateSchema(handle.connection);
    return await work(handle.connection);
  } finally {
    await handle.close();
  }
}

export function createPersistentHistoryInspectionService(
  options: PersistentHistoryInspectionServiceOptions,
): HistoryInspectionService {
  return {
    async getHistoryFeed(_request) {
      return withHistoryDatabase(options, async (connection) => {
        const rows = await listHistoryFeedRows(connection);
        return {
          items: rows.map((row) => buildHistoryFeedItem(row)),
        };
      });
    },

    async getHistoryEntry(request) {
      return withHistoryDatabase(options, async (connection) => {
        const row = await readHistoryEntryRow(connection, request.runId);

        if (!row) {
          throw new Error(`저장된 히스토리 실행을 찾을 수 없습니다: ${request.runId}`);
        }

        if (!row.prompt_ko.trim()) {
          throw new Error(`저장된 한국어 원문이 비어 있습니다: ${request.runId}`);
        }

        const finalResponseContent = row.restored_response_ko ?? row.assistant_response_ko ?? '';
        if (!finalResponseContent.trim()) {
          throw new Error(`저장된 최종 응답이 비어 있습니다: ${request.runId}`);
        }

        return mapHistoryEntry(row);
      });
    },
  };
}
