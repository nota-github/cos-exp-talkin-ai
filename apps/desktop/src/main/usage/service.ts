import type {
  CloudModelId,
  UsageDashboardCategoryId,
  UsageDashboardPricingBasis,
  UsageDashboardQuery,
  UsageDashboardResult,
} from '../../shared/ipc/contracts';
import type { ProviderId, TaskUsageCategory } from '../persistence/types.ts';
import {
  migrateDesktopSchema,
  openSqliteDatabase,
  type SqliteConnection,
  type SqliteDatabaseHandle,
} from '../persistence/database';

type UsageAggregateRow = {
  occurred_at: string;
  usage_category: TaskUsageCategory;
  provider: ProviderId;
  model: CloudModelId;
  pricing_version: string;
  baseline_input_tokens: number;
  optimized_input_tokens: number;
  estimated_cost_without_optimization: number;
  estimated_cost_with_optimization: number;
};

type UsageDashboardCategoryDefinition = {
  id: UsageDashboardCategoryId;
  label: string;
};

export interface UsageDashboardService {
  getUsageDashboard(request: UsageDashboardQuery): Promise<UsageDashboardResult>;
}

export type PersistentUsageDashboardServiceOptions = {
  dbPath: string;
  now?: () => string;
  openDatabase?: (filename: string) => Promise<SqliteDatabaseHandle>;
  migrateSchema?: (connection: SqliteConnection) => Promise<number>;
};

const usageDashboardCategories: UsageDashboardCategoryDefinition[] = [
  {
    id: 'general',
    label: '일반 요청',
  },
  {
    id: 'starter_template',
    label: '추천 시작 작업',
  },
  {
    id: 'project_linked',
    label: '프로젝트 연결',
  },
];

function computeSavingsRate(baselineTokens: number, optimizedTokens: number) {
  if (baselineTokens <= 0) {
    return 0;
  }

  const rawRate = Math.round((1 - optimizedTokens / baselineTokens) * 100);
  return Math.max(0, rawRate);
}

function createEmptyUsageDashboard(range: UsageDashboardQuery['range']): UsageDashboardResult {
  return {
    range,
    pricingBasis: {
      status: 'empty',
      activeBasis: null,
      bases: [],
    },
    categoryShareBasis: 'request_count',
    totals: {
      requestCount: 0,
      baselineTokens: 0,
      optimizedTokens: 0,
      tokenReduction: 0,
      savingsRate: 0,
      estimatedSavingsUsd: 0,
    },
    comparison: {
      withoutOptimization: {
        requestCount: 0,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
      withOptimization: {
        requestCount: 0,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
    },
    categories: usageDashboardCategories.map((category) => ({
      id: category.id,
      label: category.label,
      requestCount: 0,
      baselineTokens: 0,
      optimizedTokens: 0,
      tokenReduction: 0,
      savingsRate: 0,
      share: 0,
    })),
  };
}

function isSameUtcMonth(leftIso: string, rightIso: string) {
  const left = new Date(leftIso);
  const right = new Date(rightIso);

  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth()
  );
}

function filterRowsForRange(
  rows: UsageAggregateRow[],
  range: UsageDashboardQuery['range'],
  nowIso: string,
) {
  if (range === 'all_time') {
    return rows;
  }

  return rows.filter((row) => isSameUtcMonth(row.occurred_at, nowIso));
}

async function listUsageAggregateRows(connection: SqliteConnection): Promise<UsageAggregateRow[]> {
  return connection.query<UsageAggregateRow>(`
    SELECT
      COALESCE(run_records.ended_at, run_records.started_at) AS occurred_at,
      tasks.usage_category AS usage_category,
      run_records.provider AS provider,
      run_records.model AS model,
      usage_records.pricing_version AS pricing_version,
      usage_records.baseline_input_tokens AS baseline_input_tokens,
      usage_records.optimized_input_tokens AS optimized_input_tokens,
      usage_records.estimated_cost_without_optimization AS estimated_cost_without_optimization,
      usage_records.estimated_cost_with_optimization AS estimated_cost_with_optimization
    FROM usage_records
    INNER JOIN run_records
      ON run_records.id = usage_records.run_id
    INNER JOIN tasks
      ON tasks.id = run_records.task_id
    WHERE COALESCE(run_records.ended_at, run_records.started_at) IS NOT NULL
    ORDER BY COALESCE(run_records.ended_at, run_records.started_at) ASC, usage_records.rowid ASC;
  `);
}

function listPricingBases(rows: UsageAggregateRow[]): UsageDashboardPricingBasis[] {
  const basisByKey = new Map<string, UsageDashboardPricingBasis>();

  for (const row of rows) {
    const key = `${row.provider}::${row.model}::${row.pricing_version}`;
    const existing = basisByKey.get(key);

    if (existing) {
      existing.requestCount += 1;
      continue;
    }

    basisByKey.set(key, {
      provider: row.provider,
      model: row.model,
      pricingVersion: row.pricing_version,
      requestCount: 1,
    });
  }

  return Array.from(basisByKey.values()).sort((left, right) => {
    if (right.requestCount !== left.requestCount) {
      return right.requestCount - left.requestCount;
    }

    const leftKey = `${left.provider}::${left.model}::${left.pricingVersion}`;
    const rightKey = `${right.provider}::${right.model}::${right.pricingVersion}`;
    return leftKey.localeCompare(rightKey);
  });
}

function buildUsageDashboardResult(
  range: UsageDashboardQuery['range'],
  rows: UsageAggregateRow[],
): UsageDashboardResult {
  const baseResult = createEmptyUsageDashboard(range);

  if (rows.length === 0) {
    return baseResult;
  }

  const pricingBases = listPricingBases(rows);

  if (pricingBases.length > 1) {
    return {
      range,
      pricingBasis: {
        status: 'mixed',
        activeBasis: null,
        bases: pricingBases,
      },
      categoryShareBasis: 'request_count',
      totals: {
        requestCount: rows.length,
        baselineTokens: 0,
        optimizedTokens: 0,
        tokenReduction: 0,
        savingsRate: 0,
        estimatedSavingsUsd: 0,
      },
      comparison: {
        withoutOptimization: {
          requestCount: rows.length,
          inputTokens: 0,
          estimatedCostUsd: 0,
        },
        withOptimization: {
          requestCount: rows.length,
          inputTokens: 0,
          estimatedCostUsd: 0,
        },
      },
      categories: usageDashboardCategories.map((category) => {
        const categoryRows = rows.filter((row) => row.usage_category === category.id);

        return {
          id: category.id,
          label: category.label,
          requestCount: categoryRows.length,
          baselineTokens: 0,
          optimizedTokens: 0,
          tokenReduction: 0,
          savingsRate: 0,
          share:
            rows.length > 0 ? Math.round((categoryRows.length / rows.length) * 100) : 0,
        };
      }),
    };
  }

  const totals = rows.reduce(
    (aggregate, row) => ({
      requestCount: aggregate.requestCount + 1,
      baselineTokens: aggregate.baselineTokens + row.baseline_input_tokens,
      optimizedTokens: aggregate.optimizedTokens + row.optimized_input_tokens,
      estimatedCostWithoutOptimization:
        aggregate.estimatedCostWithoutOptimization + row.estimated_cost_without_optimization,
      estimatedCostWithOptimization:
        aggregate.estimatedCostWithOptimization + row.estimated_cost_with_optimization,
    }),
    {
      requestCount: 0,
      baselineTokens: 0,
      optimizedTokens: 0,
      estimatedCostWithoutOptimization: 0,
      estimatedCostWithOptimization: 0,
    },
  );

  const baselineTokens = totals.baselineTokens;
  const optimizedTokens = totals.optimizedTokens;
  const tokenReduction = Math.max(0, baselineTokens - optimizedTokens);
  const estimatedSavingsUsd = Number(
    (totals.estimatedCostWithoutOptimization - totals.estimatedCostWithOptimization).toFixed(6),
  );

  return {
    range,
    pricingBasis: {
      status: 'single',
      activeBasis: pricingBases[0] ?? null,
      bases: pricingBases,
    },
    categoryShareBasis: 'baseline_tokens',
    totals: {
      requestCount: totals.requestCount,
      baselineTokens,
      optimizedTokens,
      tokenReduction,
      savingsRate: computeSavingsRate(baselineTokens, optimizedTokens),
      estimatedSavingsUsd,
    },
    comparison: {
      withoutOptimization: {
        requestCount: totals.requestCount,
        inputTokens: baselineTokens,
        estimatedCostUsd: Number(totals.estimatedCostWithoutOptimization.toFixed(6)),
      },
      withOptimization: {
        requestCount: totals.requestCount,
        inputTokens: optimizedTokens,
        estimatedCostUsd: Number(totals.estimatedCostWithOptimization.toFixed(6)),
      },
    },
    categories: usageDashboardCategories.map((category) => {
      const categoryRows = rows.filter((row) => row.usage_category === category.id);
      const categoryBaselineTokens = categoryRows.reduce(
        (sum, row) => sum + row.baseline_input_tokens,
        0,
      );
      const categoryOptimizedTokens = categoryRows.reduce(
        (sum, row) => sum + row.optimized_input_tokens,
        0,
      );
      const categoryTokenReduction = Math.max(
        0,
        categoryBaselineTokens - categoryOptimizedTokens,
      );

      return {
        id: category.id,
        label: category.label,
        requestCount: categoryRows.length,
        baselineTokens: categoryBaselineTokens,
        optimizedTokens: categoryOptimizedTokens,
        tokenReduction: categoryTokenReduction,
        savingsRate: computeSavingsRate(categoryBaselineTokens, categoryOptimizedTokens),
        share:
          baselineTokens > 0
            ? Math.round((categoryBaselineTokens / baselineTokens) * 100)
            : 0,
      };
    }),
  };
}

async function withUsageDashboardDatabase<TValue>(
  options: PersistentUsageDashboardServiceOptions,
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

export function createPersistentUsageDashboardService(
  options: PersistentUsageDashboardServiceOptions,
): UsageDashboardService {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async getUsageDashboard(request) {
      return withUsageDashboardDatabase(options, async (connection) => {
        const rows = await listUsageAggregateRows(connection);
        const filteredRows = filterRowsForRange(rows, request.range, now());
        return buildUsageDashboardResult(request.range, filteredRows);
      });
    },
  };
}
