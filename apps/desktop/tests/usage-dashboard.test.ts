import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
  openSqliteDatabase,
  type ChatRunPersistence,
} from '../src/main/persistence/index.ts';
import { createPersistentUsageDashboardService } from '../src/main/usage/index.ts';
import {
  getUsageCumulativeBody,
  getUsageCumulativeLabel,
  getUsageCumulativeCards,
  getUsagePricingBasisLabel,
  getUsageComparisonCards,
  getUsageMetricCards,
  getUsageProofLabel,
  getUsageSurfaceState,
  isUsageDashboardComparable,
  previewAllTimeUsageDashboard,
  previewUsageDashboard,
  usageDashboardCopy,
} from '../src/renderer/routes/usage-surface.ts';

const usageRouteSource = readFileSync(new URL('../src/renderer/routes/UsageRoute.tsx', import.meta.url), 'utf8');
const appShellSource = readFileSync(new URL('../src/renderer/app/AppShell.tsx', import.meta.url), 'utf8');
const navigationSource = readFileSync(new URL('../src/renderer/app/navigation.ts', import.meta.url), 'utf8');
const usageStylesSource = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

type TempUsageHarness = {
  dbPath: string;
  cleanup(): Promise<void>;
  persistence: ChatRunPersistence;
};

async function createTempUsageHarness(): Promise<TempUsageHarness> {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-usage-dashboard-'));
  const dbPath = join(directory, 'talkin-ai.db');
  writeFileSync(dbPath, '');

  const handle = await openSqliteDatabase(dbPath);
  await migrateDesktopSchema(handle.connection);
  const persistence = createChatRunPersistence(handle.connection);

  return {
    dbPath,
    persistence,
    async cleanup() {
      await persistence.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function insertCompletedRun(
  persistence: ChatRunPersistence,
  input: {
    suffix: string;
    usageCategory: 'general' | 'starter_template' | 'project_linked';
    startedAt: string;
    endedAt: string;
    provider?: 'openai' | 'anthropic' | 'google';
    model?: 'gpt-4.1' | 'claude-sonnet-4' | 'gemini-1.5-pro';
    pricingVersion?: string;
    baselineTokens: number;
    optimizedTokens: number;
    withoutCostUsd: number;
    withCostUsd: number;
  },
) {
  await persistence.tasks.create({
    id: `task-${input.suffix}`,
    title: `usage task ${input.suffix}`,
    status: 'completed',
    projectId: input.usageCategory === 'project_linked' ? `project-${input.suffix}` : null,
    sourceScreen: 'chat',
    usageCategory: input.usageCategory,
    createdAt: input.startedAt,
    updatedAt: input.endedAt,
    lastActivityAt: input.endedAt,
  });

  await persistence.conversations.create({
    id: `conversation-${input.suffix}`,
    taskId: `task-${input.suffix}`,
    summary: `usage summary ${input.suffix}`,
    mode: 'balanced',
    selectedModel: 'gpt-4.1',
    createdAt: input.startedAt,
    updatedAt: input.endedAt,
  });

  await persistence.messages.create({
    id: `message-${input.suffix}`,
    conversationId: `conversation-${input.suffix}`,
    role: 'user',
    contentKo: `usage prompt ${input.suffix}`,
    runId: `run-${input.suffix}`,
    createdAt: input.startedAt,
  });

  await persistence.runRecords.create({
    id: `run-${input.suffix}`,
    taskId: `task-${input.suffix}`,
    conversationId: `conversation-${input.suffix}`,
    messageId: `message-${input.suffix}`,
    status: 'completed',
    provider: input.provider ?? 'openai',
    model: input.model ?? 'gpt-4.1',
    mode: 'balanced',
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    errorCode: null,
  });

  await persistence.usageRecords.create({
    id: `usage-${input.suffix}`,
    runId: `run-${input.suffix}`,
    baselineInputTokens: input.baselineTokens,
    optimizedInputTokens: input.optimizedTokens,
    outputTokens: 96,
    estimatedCostWithoutOptimization: input.withoutCostUsd,
    estimatedCostWithOptimization: input.withCostUsd,
    pricingVersion: input.pricingVersion ?? 'openai-gpt-4.1-2026-06',
    latencyMs: 640,
    isEstimated: false,
  });
}

test('story-4.3:VAL-1, story-4.3:AC-1, and story-4.3:AC-2 compute monthly totals and same-period comparison from persisted usage rows', async () => {
  const temp = await createTempUsageHarness();
  const service = createPersistentUsageDashboardService({
    dbPath: temp.dbPath,
    now: () => '2026-06-20T09:00:00.000Z',
  });

  try {
    await insertCompletedRun(temp.persistence, {
      suffix: 'general-june',
      usageCategory: 'general',
      startedAt: '2026-06-02T09:00:00.000Z',
      endedAt: '2026-06-02T09:03:00.000Z',
      baselineTokens: 1_000,
      optimizedTokens: 700,
      withoutCostUsd: 1.2,
      withCostUsd: 0.84,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'starter-june',
      usageCategory: 'starter_template',
      startedAt: '2026-06-08T10:00:00.000Z',
      endedAt: '2026-06-08T10:06:00.000Z',
      baselineTokens: 800,
      optimizedTokens: 400,
      withoutCostUsd: 0.96,
      withCostUsd: 0.48,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'project-june',
      usageCategory: 'project_linked',
      startedAt: '2026-06-12T14:00:00.000Z',
      endedAt: '2026-06-12T14:08:00.000Z',
      baselineTokens: 1_200,
      optimizedTokens: 900,
      withoutCostUsd: 1.44,
      withCostUsd: 1.08,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'general-may',
      usageCategory: 'general',
      startedAt: '2026-05-21T11:00:00.000Z',
      endedAt: '2026-05-21T11:04:00.000Z',
      baselineTokens: 600,
      optimizedTokens: 300,
      withoutCostUsd: 0.72,
      withCostUsd: 0.36,
    });

    const monthDashboard = await service.getUsageDashboard({ range: 'month' });
    const allTimeDashboard = await service.getUsageDashboard({ range: 'all_time' });

    assert.equal(monthDashboard.pricingBasis.status, 'single');
    assert.deepEqual(monthDashboard.pricingBasis.activeBasis, {
      provider: 'openai',
      model: 'gpt-4.1',
      pricingVersion: 'openai-gpt-4.1-2026-06',
      requestCount: 3,
    });
    assert.equal(monthDashboard.categoryShareBasis, 'baseline_tokens');
    assert.deepEqual(monthDashboard.totals, {
      requestCount: 3,
      baselineTokens: 3_000,
      optimizedTokens: 2_000,
      tokenReduction: 1_000,
      savingsRate: 33,
      estimatedSavingsUsd: 1.2,
    });
    assert.deepEqual(monthDashboard.comparison, {
      withoutOptimization: {
        requestCount: 3,
        inputTokens: 3_000,
        estimatedCostUsd: 3.6,
      },
      withOptimization: {
        requestCount: 3,
        inputTokens: 2_000,
        estimatedCostUsd: 2.4,
      },
    });
    assert.equal(allTimeDashboard.totals.requestCount, 4);
    assert.equal(allTimeDashboard.totals.baselineTokens, 3_600);
    assert.equal(allTimeDashboard.totals.optimizedTokens, 2_300);
    assert.equal(allTimeDashboard.totals.estimatedSavingsUsd, 1.56);
  } finally {
    await temp.cleanup();
  }
});

test('story-4.3:VAL-1 and story-4.3:AC-2 suppress combined savings proof when persisted rows mix pricing bases', async () => {
  const temp = await createTempUsageHarness();
  const service = createPersistentUsageDashboardService({
    dbPath: temp.dbPath,
    now: () => '2026-06-20T09:00:00.000Z',
  });

  try {
    await insertCompletedRun(temp.persistence, {
      suffix: 'openai-mixed',
      usageCategory: 'general',
      startedAt: '2026-06-04T09:00:00.000Z',
      endedAt: '2026-06-04T09:03:00.000Z',
      provider: 'openai',
      model: 'gpt-4.1',
      pricingVersion: 'openai-gpt-4.1-2026-06',
      baselineTokens: 900,
      optimizedTokens: 600,
      withoutCostUsd: 1.08,
      withCostUsd: 0.72,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'anthropic-mixed',
      usageCategory: 'starter_template',
      startedAt: '2026-06-09T09:00:00.000Z',
      endedAt: '2026-06-09T09:05:00.000Z',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
      baselineTokens: 1_100,
      optimizedTokens: 650,
      withoutCostUsd: 1.54,
      withCostUsd: 0.91,
    });

    const dashboard = await service.getUsageDashboard({ range: 'month' });

    assert.equal(dashboard.pricingBasis.status, 'mixed');
    assert.equal(dashboard.pricingBasis.activeBasis, null);
    assert.deepEqual(dashboard.pricingBasis.bases, [
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
        requestCount: 1,
      },
      {
        provider: 'openai',
        model: 'gpt-4.1',
        pricingVersion: 'openai-gpt-4.1-2026-06',
        requestCount: 1,
      },
    ]);
    assert.equal(dashboard.categoryShareBasis, 'request_count');
    assert.deepEqual(dashboard.totals, {
      requestCount: 2,
      baselineTokens: 0,
      optimizedTokens: 0,
      tokenReduction: 0,
      savingsRate: 0,
      estimatedSavingsUsd: 0,
    });
    assert.deepEqual(dashboard.comparison, {
      withoutOptimization: {
        requestCount: 2,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
      withOptimization: {
        requestCount: 2,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
    });
    assert.deepEqual(
      dashboard.categories.map((category) => ({
        id: category.id,
        requestCount: category.requestCount,
        share: category.share,
      })),
      [
        { id: 'general', requestCount: 1, share: 50 },
        { id: 'starter_template', requestCount: 1, share: 50 },
        { id: 'project_linked', requestCount: 0, share: 0 },
      ],
    );
  } finally {
    await temp.cleanup();
  }
});

test('story-4.3:VAL-2 and story-4.3:AC-4 return an empty-state-ready dashboard when no usage data exists yet', async () => {
  const temp = await createTempUsageHarness();
  const service = createPersistentUsageDashboardService({
    dbPath: temp.dbPath,
    now: () => '2026-06-20T09:00:00.000Z',
  });

  try {
    const dashboard = await service.getUsageDashboard({ range: 'month' });

    assert.equal(dashboard.totals.requestCount, 0);
    assert.equal(dashboard.totals.baselineTokens, 0);
    assert.equal(dashboard.totals.optimizedTokens, 0);
    assert.equal(dashboard.categories.length, 3);
    assert.equal(usageDashboardCopy.emptyCta, '채팅에서 첫 요청 시작하기');
    assert.match(usageDashboardCopy.emptyBody, /첫 한국어 요청/);
  } finally {
    await temp.cleanup();
  }
});

test('story-4.3:AC-1 and story-4.3:AC-2 keep cumulative history visible while a current-month zero state stays separate from mixed-basis proof pauses', async () => {
  const temp = await createTempUsageHarness();
  const service = createPersistentUsageDashboardService({
    dbPath: temp.dbPath,
    now: () => '2026-06-20T09:00:00.000Z',
  });

  try {
    await insertCompletedRun(temp.persistence, {
      suffix: 'prior-month-only',
      usageCategory: 'general',
      startedAt: '2026-05-10T09:00:00.000Z',
      endedAt: '2026-05-10T09:04:00.000Z',
      baselineTokens: 900,
      optimizedTokens: 540,
      withoutCostUsd: 1.08,
      withCostUsd: 0.648,
    });

    const monthDashboard = await service.getUsageDashboard({ range: 'month' });
    const allTimeDashboard = await service.getUsageDashboard({ range: 'all_time' });

    assert.equal(monthDashboard.pricingBasis.status, 'empty');
    assert.equal(monthDashboard.totals.requestCount, 0);
    assert.equal(allTimeDashboard.pricingBasis.status, 'single');
    assert.equal(allTimeDashboard.totals.requestCount, 1);
    assert.equal(isUsageDashboardComparable(monthDashboard), false);
    assert.equal(getUsagePricingBasisLabel(monthDashboard), '이번 달 기록 없음');
    assert.match(getUsageProofLabel(monthDashboard), /이번 달 아직 기록이 없어/);
    assert.equal(
      getUsageCumulativeBody({
        allTimeComparable: true,
        showMonthEmptyState: true,
      }),
      usageDashboardCopy.cumulativeQuietMonthBody,
    );
    assert.doesNotMatch(
      getUsageCumulativeBody({
        allTimeComparable: true,
        showMonthEmptyState: true,
      }),
      /이번 달 기록과 함께/,
    );
    assert.match(usageRouteSource, /showMonthEmptyState/);
    assert.match(usageRouteSource, /usage-month-empty-panel/);
    assert.match(usageRouteSource, /monthEmptyTitle/);
  } finally {
    await temp.cleanup();
  }
});

test('story-4.3:VAL-3 and story-4.3:AC-3 keep usage breakdown categories aligned with persisted task metadata', async () => {
  const temp = await createTempUsageHarness();
  const service = createPersistentUsageDashboardService({
    dbPath: temp.dbPath,
    now: () => '2026-06-20T09:00:00.000Z',
  });

  try {
    await insertCompletedRun(temp.persistence, {
      suffix: 'general-breakdown',
      usageCategory: 'general',
      startedAt: '2026-06-03T09:00:00.000Z',
      endedAt: '2026-06-03T09:02:00.000Z',
      baselineTokens: 1_000,
      optimizedTokens: 700,
      withoutCostUsd: 1.2,
      withCostUsd: 0.84,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'starter-breakdown',
      usageCategory: 'starter_template',
      startedAt: '2026-06-07T09:00:00.000Z',
      endedAt: '2026-06-07T09:02:00.000Z',
      baselineTokens: 800,
      optimizedTokens: 400,
      withoutCostUsd: 0.96,
      withCostUsd: 0.48,
    });
    await insertCompletedRun(temp.persistence, {
      suffix: 'project-breakdown',
      usageCategory: 'project_linked',
      startedAt: '2026-06-11T09:00:00.000Z',
      endedAt: '2026-06-11T09:02:00.000Z',
      baselineTokens: 1_200,
      optimizedTokens: 900,
      withoutCostUsd: 1.44,
      withCostUsd: 1.08,
    });

    const dashboard = await service.getUsageDashboard({ range: 'month' });

    assert.deepEqual(
      dashboard.categories.map((category) => category.id),
      ['general', 'starter_template', 'project_linked'],
    );
    assert.deepEqual(
      dashboard.categories.map((category) => category.label),
      ['일반 요청', '추천 시작 작업', '프로젝트 연결'],
    );
    assert.deepEqual(
      dashboard.categories.map((category) => category.requestCount),
      [1, 1, 1],
    );
    assert.deepEqual(
      dashboard.categories.map((category) => category.baselineTokens),
      [1_000, 800, 1_200],
    );
    assert.deepEqual(
      dashboard.categories.map((category) => category.share),
      [33, 27, 40],
    );
  } finally {
    await temp.cleanup();
  }
});

test('story-4.3:SCOPE-1 and story-4.3:SCOPE-2 derive summary cards, comparison copy, and explicit pricing basis labels from the dashboard contract', () => {
  const metricCards = getUsageMetricCards(previewUsageDashboard);
  const comparisonCards = getUsageComparisonCards(previewUsageDashboard);

  assert.deepEqual(
    metricCards.map((card) => card.label),
    ['이번 달 클라우드 입력', '토큰 절감률', '절감 금액', '줄인 입력 토큰'],
  );
  assert.equal(metricCards[1]?.tone, 'savings');
  assert.equal(metricCards[2]?.value, '$17.83');
  assert.equal(metricCards[3]?.value, '7,430 토큰');
  assert.equal(comparisonCards[0]?.eyebrow, '최적화 전');
  assert.equal(comparisonCards[1]?.eyebrow, '로컬 최적화 후');
  assert.equal(comparisonCards[0]?.title, '로컬 최적화 없이 보냈다면');
  assert.equal(comparisonCards[1]?.title, '로컬 최적화를 적용하면');
  assert.equal(isUsageDashboardComparable(previewUsageDashboard), true);
  assert.match(getUsagePricingBasisLabel(previewUsageDashboard), /GPT-4\.1/);
  assert.match(getUsagePricingBasisLabel(previewUsageDashboard), /요금 기준/);
  assert.match(getUsageProofLabel(previewUsageDashboard), /토큰/);
  assert.match(getUsageProofLabel(previewUsageDashboard), /달러를 줄였습니다/);
});

test('story-4.3:AC-1 renderer exposes cumulative persisted savings alongside the monthly dashboard and marks mixed-basis states explicitly', () => {
  const cumulativeCards = getUsageCumulativeCards(previewAllTimeUsageDashboard);
  const mixedDashboard = {
    ...previewUsageDashboard,
    pricingBasis: {
      status: 'mixed' as const,
      activeBasis: null,
      bases: [
        {
          provider: 'openai' as const,
          model: 'gpt-4.1' as const,
          pricingVersion: 'openai-gpt-4.1-2026-06',
          requestCount: 4,
        },
        {
          provider: 'anthropic' as const,
          model: 'claude-sonnet-4' as const,
          pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
          requestCount: 5,
        },
      ],
    },
    categoryShareBasis: 'request_count' as const,
    totals: {
      requestCount: 9,
      baselineTokens: 0,
      optimizedTokens: 0,
      tokenReduction: 0,
      savingsRate: 0,
      estimatedSavingsUsd: 0,
    },
    comparison: {
      withoutOptimization: {
        requestCount: 9,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
      withOptimization: {
        requestCount: 9,
        inputTokens: 0,
        estimatedCostUsd: 0,
      },
    },
  };

  assert.deepEqual(
    cumulativeCards.map((card) => card.label),
    ['누적 실행', '누적 절감 금액', '누적 절감 토큰'],
  );
  assert.equal(cumulativeCards[1]?.value, '$53.21');
  assert.equal(cumulativeCards[2]?.value, '22,170 토큰');
  assert.match(getUsageCumulativeLabel(previewAllTimeUsageDashboard), /누적 절감했습니다/);
  assert.equal(
    getUsageCumulativeBody({
      allTimeComparable: false,
      showMonthEmptyState: false,
    }),
    usageDashboardCopy.cumulativeMixedBasisIntro,
  );
  assert.match(usageDashboardCopy.cumulativeMixedBasisBody, /누적 기록/);
  assert.doesNotMatch(usageDashboardCopy.cumulativeMixedBasisBody, /이번 달 기록 안에/);
  assert.match(usageDashboardCopy.mixedBasisBody, /이번 달 기록 안에/);
  assert.doesNotMatch(
    getUsageCumulativeBody({
      allTimeComparable: false,
      showMonthEmptyState: false,
    }),
    /이번 달 기록과 함께/,
  );
  assert.equal(isUsageDashboardComparable(mixedDashboard), false);
  assert.match(getUsagePricingBasisLabel(mixedDashboard), /2개의 요금 기준/);
  assert.match(getUsageProofLabel(mixedDashboard), /서로 다른 요금 기준/);
  assert.equal(getUsagePricingBasisLabel({ ...previewUsageDashboard, pricingBasis: { status: 'empty', activeBasis: null, bases: [] } }), '이번 달 기록 없음');
  assert.match(usageRouteSource, /getUsageCumulativeBody/);
  assert.match(usageRouteSource, /range:\s*'month'/);
  assert.match(usageRouteSource, /range:\s*'all_time'/);
  assert.match(usageRouteSource, /usage-cumulative-panel/);
  assert.match(usageRouteSource, /cumulativeMixedBasisBody/);
  assert.match(usageRouteSource, /getUsageCumulativeCards/);
  assert.match(usageRouteSource, /usage-mixed-basis-panel/);
  assert.match(usageRouteSource, /usage-month-empty-panel/);
  assert.match(usageRouteSource, /getUsagePricingBasisLabel/);
});

test('story-4.3:GOAL-1 picks one top-level surface state and never renders loading plus error at the same time', () => {
  assert.equal(
    getUsageSurfaceState({
      desktopAvailable: true,
      monthStatus: 'error',
      allTimeStatus: 'loading',
      hasMonthData: false,
      hasAllTimeData: false,
      allTimeEmpty: false,
    }),
    'error',
  );
  assert.equal(
    getUsageSurfaceState({
      desktopAvailable: true,
      monthStatus: 'loading',
      allTimeStatus: 'loading',
      hasMonthData: false,
      hasAllTimeData: false,
      allTimeEmpty: false,
    }),
    'loading',
  );
  assert.equal(
    getUsageSurfaceState({
      desktopAvailable: true,
      monthStatus: 'success',
      allTimeStatus: 'success',
      hasMonthData: true,
      hasAllTimeData: true,
      allTimeEmpty: true,
    }),
    'empty',
  );
  assert.match(usageRouteSource, /getUsageSurfaceState/);
});

test('story-4.3:AC-5 and story-4.3:AC-6 source uses a comparison-led proof board and mint savings accents instead of a generic admin card grid', () => {
  const usageCopySource = JSON.stringify(usageDashboardCopy);

  assert.match(usageDashboardCopy.headline, /더 오래/);
  assert.match(usageDashboardCopy.comparisonTitle, /로컬 최적화 전후 비교/);
  assert.match(usageRouteSource, /사용량 대시보드/);
  assert.match(usageRouteSource, /토큰 감소/);
  assert.match(usageRouteSource, /usage-proof-board/);
  assert.match(usageRouteSource, /usage-cumulative-panel/);
  assert.match(usageRouteSource, /usage-mixed-basis-panel/);
  assert.match(usageRouteSource, /usage-month-empty-panel/);
  assert.match(usageRouteSource, /usage-empty-state/);
  assert.match(appShellSource, /한국어 우선 AI 작업 공간/);
  assert.match(appShellSource, /작업 공간 준비됨/);
  assert.match(appShellSource, /채팅, 작업대, 프로젝트를 한 흐름으로 이어가는/);
  assert.match(appShellSource, /절감 근거 추적 화면/);
  assert.match(navigationSource, /label:\s*'채팅'/);
  assert.match(navigationSource, /label:\s*'작업대'/);
  assert.match(navigationSource, /label:\s*'프로젝트'/);
  assert.match(navigationSource, /label:\s*'사용량'/);
  assert.match(navigationSource, /label:\s*'설정'/);
  assert.match(navigationSource, /eyebrow:\s*'인박스'/);
  assert.match(navigationSource, /eyebrow:\s*'분할 작업'/);
  assert.match(navigationSource, /eyebrow:\s*'절감 근거'/);
  assert.match(usageRouteSource, /createDesktopQueryDescriptor\('getUsageDashboard'/);
  assert.match(usageStylesSource, /\.usage-cumulative-panel\s*\{/);
  assert.match(usageStylesSource, /\.usage-mixed-basis-panel\s*\{/);
  assert.match(usageStylesSource, /\.usage-month-empty-panel\s*\{/);
  assert.match(usageStylesSource, /\.usage-cumulative-card-savings\s*\{/);
  assert.match(usageStylesSource, /\.usage-proof-layout\s*\{/);
  assert.match(
    usageStylesSource,
    /grid-template-columns:\s*minmax\(0,\s*1\.18fr\)\s*minmax\(320px,\s*0\.82fr\);/,
  );
  assert.match(usageStylesSource, /\.usage-comparison-ledger\s*\{/);
  assert.match(usageStylesSource, /\.usage-category-bar-fill\s*\{/);
  assert.match(
    usageStylesSource,
    /background:\s*linear-gradient\(90deg,\s*var\(--blue\)\s*0%,\s*var\(--mint\)\s*100%\);/,
  );
  assert.doesNotMatch(usageRouteSource, /'Usage Dashboard'|"Usage Dashboard"/);
  assert.doesNotMatch(usageRouteSource, /'Loading'|"Loading"/);
  assert.doesNotMatch(usageRouteSource, /'Usage Error'|"Usage Error"/);
  assert.doesNotMatch(usageRouteSource, /'Empty Dashboard'|"Empty Dashboard"/);
  assert.doesNotMatch(usageRouteSource, /'Cumulative Savings'|"Cumulative Savings"/);
  assert.doesNotMatch(usageRouteSource, /'Savings Proof'|"Savings Proof"/);
  assert.doesNotMatch(usageRouteSource, /'Mixed Pricing Basis'|"Mixed Pricing Basis"/);
  assert.doesNotMatch(usageRouteSource, /'preview mode'|"preview mode"/);
  assert.doesNotMatch(usageRouteSource, /'proof paused'|"proof paused"/);
  assert.doesNotMatch(usageRouteSource, /\btokens\b/);
  assert.doesNotMatch(appShellSource, /'Korean-First Agent'|"Korean-First Agent"/);
  assert.doesNotMatch(appShellSource, /'Shell Ready'|"Shell Ready"/);
  assert.doesNotMatch(appShellSource, /'Workspace'|"Workspace"/);
  assert.doesNotMatch(appShellSource, /context isolation/i);
  assert.doesNotMatch(navigationSource, /label:\s*'Chat'/);
  assert.doesNotMatch(navigationSource, /label:\s*'Workbench'/);
  assert.doesNotMatch(navigationSource, /label:\s*'Projects'/);
  assert.doesNotMatch(navigationSource, /label:\s*'Usage'/);
  assert.doesNotMatch(navigationSource, /label:\s*'Settings'/);
  assert.doesNotMatch(navigationSource, /eyebrow:\s*'Inbox'/);
  assert.doesNotMatch(navigationSource, /eyebrow:\s*'Split View'/);
  assert.doesNotMatch(navigationSource, /eyebrow:\s*'Portfolio'/);
  assert.doesNotMatch(navigationSource, /eyebrow:\s*'Savings'/);
  assert.doesNotMatch(navigationSource, /eyebrow:\s*'Controls'/);
  assert.doesNotMatch(usageCopySource, /Without Optimization/);
  assert.doesNotMatch(usageCopySource, /With Local Optimization/);
  assert.doesNotMatch(usageCopySource, /persisted/i);
  assert.doesNotMatch(usageCopySource, /pricing basis/i);
  assert.doesNotMatch(usageCopySource, /usage_category/i);
  assert.doesNotMatch(usageCopySource, /starter\/template/i);
});
