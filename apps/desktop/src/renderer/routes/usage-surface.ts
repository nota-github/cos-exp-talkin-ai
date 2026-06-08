import type {
  UsageDashboardPricingBasis,
  UsageDashboardResult,
} from '../../shared/ipc/contracts';

type UsageMetricCard = {
  id: 'optimized_tokens' | 'savings_rate' | 'estimated_savings' | 'token_reduction';
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'savings';
};

type UsageCumulativeCard = {
  id: 'request_count' | 'estimated_savings' | 'token_reduction';
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'savings';
};

type UsageComparisonCard = {
  id: 'without_optimization' | 'with_optimization';
  eyebrow: string;
  title: string;
  body: string;
  inputTokensLabel: string;
  costLabel: string;
  tone: 'warning' | 'success';
};

export type UsageSurfaceState = 'loading' | 'error' | 'empty' | 'ready';

export const usageDashboardCopy = {
  headline: '이번 달, 한국어 AI를 얼마나 더 오래 쓸 수 있었는지 보여줍니다',
  intro:
    '원문 한국어 입력과 로컬 최적화 뒤의 영어 토큰 흐름을 같은 달 기준으로 비교해, 실제로 줄어든 클라우드 입력 비용을 바로 읽게 합니다.',
  proofTitle: '이번 달 로컬 최적화 절감 근거',
  proofBody:
    '유료 번역 서비스를 거치지 않고, 로컬 LLM이 먼저 한국어 요청을 다듬은 뒤 클라우드 추론으로 넘긴 결과만 집계합니다.',
  comparisonTitle: '로컬 최적화 전후 비교',
  comparisonBody:
    '같은 달, 같은 요청 수를 기준으로 클라우드에 들어간 입력 토큰과 추정 비용이 얼마나 달라졌는지 보여줍니다.',
  cumulativeTitle: '지금까지 쌓인 절감',
  cumulativeBody:
    '이번 달 기록과 함께, 지금까지 아낀 토큰과 비용을 한 화면에서 확인할 수 있어야 장기 사용 가치가 보입니다.',
  cumulativeQuietMonthBody:
    '이번 달 새 기록은 아직 없지만, 지금까지 쌓인 절감 토큰과 비용 흐름은 계속 확인할 수 있습니다.',
  cumulativeMixedBasisIntro:
    '누적 기록 안에 서로 다른 모델 요금 기준이 섞여 있어, 전체 절감액을 하나로 합치기보다 어떤 기준이 섞였는지 먼저 보여드립니다.',
  monthEmptyTitle: '이번 달 아직 기록이 없습니다',
  monthEmptyBody:
    '지금까지 쌓인 절감은 그대로 남아 있지만, 이번 달 비교는 새 한국어 요청이 저장되기 전까지 비어 있습니다.',
  monthEmptyChecklist:
    '채팅에서 새 요청을 한 번 실행하면 이번 달 절감 토큰, 절감률, 비용 비교가 다시 채워집니다.',
  monthEmptyCta: '이번 달 기록 만들기',
  mixedBasisTitle: '이번 달 기록의 요금 기준이 서로 달라 한 번에 합치지 않습니다',
  mixedBasisBody:
    '이번 달 기록 안에 서로 다른 모델 요금 기준이 함께 있어, 합산 절감액 대신 어떤 기준이 섞였는지 먼저 보여드립니다.',
  cumulativeMixedBasisBody:
    '누적 기록 안에 서로 다른 모델 요금 기준이 함께 있어, 전체 절감액을 하나로 합치기보다 어떤 기준이 섞였는지 먼저 보여드립니다.',
  mixedBasisFootnote:
    '같은 모델과 같은 요금표로 계산된 기록만 하나의 절감 근거로 묶습니다.',
  breakdownTitle: '어떤 작업 성격에서 절감이 쌓였는지',
  breakdownBody:
    '저장된 작업 유형을 기준으로 일반 요청, 추천 시작 작업, 프로젝트 연결 작업을 나눠 봅니다.',
  sourceFootnote: '저장된 실행 기록과 작업 유형을 바탕으로 계산합니다.',
  loadingTitle: '이번 달 절감 화면을 준비하는 중입니다',
  loadingBody:
    '저장된 실행 기록을 다시 읽어 이번 달 절감률과 토큰 감소량을 계산하고 있습니다.',
  errorTitle: '사용량 기록을 읽지 못했습니다',
  errorBody:
    '저장된 대화와 작업은 그대로 있습니다. 잠시 후 다시 열거나 채팅에서 새 요청을 보낸 뒤 다시 확인하세요.',
  emptyTitle: '아직 절감 기록이 없습니다',
  emptyBody:
    '채팅에서 첫 한국어 요청을 보내면 원문 토큰, 최적화 뒤 입력 토큰, 절감 금액이 이 화면에 차곡차곡 쌓입니다.',
  emptyChecklist:
    '사업계획서 초안, 긴 PDF 요약, 카피 다듬기처럼 길고 복잡한 요청으로 먼저 한 번 실행해 보세요.',
  emptyCta: '채팅에서 첫 요청 시작하기',
  previewModeBody:
    '미리보기에서는 저장된 기록 대신 예시 데이터를 보여줍니다.',
};

export const previewUsageDashboard: UsageDashboardResult = {
  range: 'month',
  pricingBasis: {
    status: 'single',
    activeBasis: {
      provider: 'openai',
      model: 'gpt-4.1',
      pricingVersion: 'openai-gpt-4.1-2026-06',
      requestCount: 9,
    },
    bases: [
      {
        provider: 'openai',
        model: 'gpt-4.1',
        pricingVersion: 'openai-gpt-4.1-2026-06',
        requestCount: 9,
      },
    ],
  },
  categoryShareBasis: 'baseline_tokens',
  totals: {
    requestCount: 9,
    baselineTokens: 18_240,
    optimizedTokens: 10_810,
    tokenReduction: 7_430,
    savingsRate: 41,
    estimatedSavingsUsd: 17.83,
  },
  comparison: {
    withoutOptimization: {
      requestCount: 9,
      inputTokens: 18_240,
      estimatedCostUsd: 43.78,
    },
    withOptimization: {
      requestCount: 9,
      inputTokens: 10_810,
      estimatedCostUsd: 25.95,
    },
  },
  categories: [
    {
      id: 'starter_template',
      label: '추천 시작 작업',
      requestCount: 4,
      baselineTokens: 8_110,
      optimizedTokens: 4_310,
      tokenReduction: 3_800,
      savingsRate: 47,
      share: 44,
    },
    {
      id: 'general',
      label: '일반 요청',
      requestCount: 3,
      baselineTokens: 6_020,
      optimizedTokens: 3_890,
      tokenReduction: 2_130,
      savingsRate: 35,
      share: 33,
    },
    {
      id: 'project_linked',
      label: '프로젝트 연결',
      requestCount: 2,
      baselineTokens: 4_110,
      optimizedTokens: 2_610,
      tokenReduction: 1_500,
      savingsRate: 36,
      share: 23,
    },
  ],
};

export const previewAllTimeUsageDashboard: UsageDashboardResult = {
  range: 'all_time',
  pricingBasis: {
    status: 'single',
    activeBasis: {
      provider: 'openai',
      model: 'gpt-4.1',
      pricingVersion: 'openai-gpt-4.1-2026-06',
      requestCount: 25,
    },
    bases: [
      {
        provider: 'openai',
        model: 'gpt-4.1',
        pricingVersion: 'openai-gpt-4.1-2026-06',
        requestCount: 25,
      },
    ],
  },
  categoryShareBasis: 'baseline_tokens',
  totals: {
    requestCount: 25,
    baselineTokens: 54_310,
    optimizedTokens: 32_140,
    tokenReduction: 22_170,
    savingsRate: 41,
    estimatedSavingsUsd: 53.21,
  },
  comparison: {
    withoutOptimization: {
      requestCount: 25,
      inputTokens: 54_310,
      estimatedCostUsd: 130.34,
    },
    withOptimization: {
      requestCount: 25,
      inputTokens: 32_140,
      estimatedCostUsd: 77.13,
    },
  },
  categories: [
    {
      id: 'starter_template',
      label: '추천 시작 작업',
      requestCount: 11,
      baselineTokens: 21_490,
      optimizedTokens: 12_410,
      tokenReduction: 9_080,
      savingsRate: 42,
      share: 40,
    },
    {
      id: 'general',
      label: '일반 요청',
      requestCount: 8,
      baselineTokens: 17_820,
      optimizedTokens: 10_980,
      tokenReduction: 6_840,
      savingsRate: 38,
      share: 33,
    },
    {
      id: 'project_linked',
      label: '프로젝트 연결',
      requestCount: 6,
      baselineTokens: 15_000,
      optimizedTokens: 8_750,
      tokenReduction: 6_250,
      savingsRate: 42,
      share: 28,
    },
  ],
};

const tokenFormatter = new Intl.NumberFormat('ko-KR');
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatTokenCount(value: number) {
  return `${tokenFormatter.format(value)} 토큰`;
}

function formatUsd(value: number) {
  return usdFormatter.format(value);
}

function formatProvider(provider: UsageDashboardPricingBasis['provider']) {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'google':
      return 'Google';
  }
}

function formatModel(model: UsageDashboardPricingBasis['model']) {
  switch (model) {
    case 'gpt-4.1':
      return 'GPT-4.1';
    case 'claude-sonnet-4':
      return 'Claude Sonnet 4';
    case 'gemini-1.5-pro':
      return 'Gemini 1.5 Pro';
  }
}

function formatPricingPeriod(pricingVersion: string) {
  const match = pricingVersion.match(/(\d{4})-(\d{2})$/);
  if (!match) {
    return '저장된 요금표';
  }

  const [, year, month] = match;
  return `${year}년 ${Number(month)}월 요금표`;
}

function formatPricingBasis(basis: UsageDashboardPricingBasis) {
  return `${formatProvider(basis.provider)} ${formatModel(basis.model)}`;
}

export function isUsageDashboardEmpty(dashboard: UsageDashboardResult) {
  return dashboard.totals.requestCount === 0;
}

export function isUsageDashboardComparable(dashboard: UsageDashboardResult) {
  return dashboard.pricingBasis.status === 'single' && dashboard.pricingBasis.activeBasis !== null;
}

export function getUsageSurfaceState(options: {
  desktopAvailable: boolean;
  monthStatus: string;
  allTimeStatus: string;
  hasMonthData: boolean;
  hasAllTimeData: boolean;
  allTimeEmpty: boolean;
}): UsageSurfaceState {
  if (!options.desktopAvailable) {
    return 'ready';
  }

  const missingDashboardData = !options.hasMonthData || !options.hasAllTimeData;

  if (missingDashboardData && (options.monthStatus === 'error' || options.allTimeStatus === 'error')) {
    return 'error';
  }

  if (missingDashboardData && (options.monthStatus === 'loading' || options.allTimeStatus === 'loading')) {
    return 'loading';
  }

  if (options.allTimeEmpty) {
    return 'empty';
  }

  return 'ready';
}

export function getUsageCumulativeBody(options: {
  allTimeComparable: boolean;
  showMonthEmptyState: boolean;
}) {
  if (!options.allTimeComparable) {
    return usageDashboardCopy.cumulativeMixedBasisIntro;
  }

  if (options.showMonthEmptyState) {
    return usageDashboardCopy.cumulativeQuietMonthBody;
  }

  return usageDashboardCopy.cumulativeBody;
}

export function getUsagePricingBasisLabel(dashboard: UsageDashboardResult) {
  if (dashboard.pricingBasis.status === 'single' && dashboard.pricingBasis.activeBasis) {
    const basis = dashboard.pricingBasis.activeBasis;
    return `${formatPricingBasis(basis)} 요금 기준`;
  }

  if (dashboard.pricingBasis.status === 'mixed') {
    return `${dashboard.pricingBasis.bases.length}개의 요금 기준이 함께 있습니다`;
  }

  return '이번 달 기록 없음';
}

export function getUsagePricingBasisChips(dashboard: UsageDashboardResult) {
  return dashboard.pricingBasis.bases.map((basis) => ({
    id: `${basis.provider}-${basis.model}-${basis.pricingVersion}`,
    label: formatPricingBasis(basis),
    detail: `${basis.requestCount}건 · ${formatPricingPeriod(basis.pricingVersion)}`,
  }));
}

export function getUsageCategoryShareCopy(
  dashboard: UsageDashboardResult,
  category: UsageDashboardResult['categories'][number],
) {
  if (dashboard.categoryShareBasis === 'request_count') {
    return `${category.requestCount}건 · 요청 수 기준 ${category.share}%`;
  }

  return `${category.requestCount}건 · 입력 토큰 기준 ${category.share}%`;
}

export function getUsageMetricCards(dashboard: UsageDashboardResult): UsageMetricCard[] {
  return [
    {
      id: 'optimized_tokens',
      label: '이번 달 클라우드 입력',
      value: formatTokenCount(dashboard.totals.optimizedTokens),
      detail: `실제로 클라우드 모델에 전달된 최적화 뒤 입력량 · 이번 달 ${dashboard.totals.requestCount}건`,
      tone: 'neutral',
    },
    {
      id: 'savings_rate',
      label: '토큰 절감률',
      value: `${dashboard.totals.savingsRate}%`,
      detail: '같은 달 원문 입력 대비 줄어든 비율',
      tone: 'savings',
    },
    {
      id: 'estimated_savings',
      label: '절감 금액',
      value: formatUsd(dashboard.totals.estimatedSavingsUsd),
      detail: '유료 번역 서비스 없이 로컬 최적화를 거쳤을 때 아낀 추정 금액',
      tone: 'savings',
    },
    {
      id: 'token_reduction',
      label: '줄인 입력 토큰',
      value: formatTokenCount(dashboard.totals.tokenReduction),
      detail: '원문 한국어를 그대로 보냈다면 더 들었을 클라우드 입력량',
      tone: 'neutral',
    },
  ];
}

export function getUsageCumulativeCards(
  dashboard: UsageDashboardResult,
): UsageCumulativeCard[] {
  return [
    {
      id: 'request_count',
      label: '누적 실행',
      value: `${tokenFormatter.format(dashboard.totals.requestCount)}건`,
      detail: '저장된 실행 기록 기준 전체 실행 수',
      tone: 'neutral',
    },
    {
      id: 'estimated_savings',
      label: '누적 절감 금액',
      value: formatUsd(dashboard.totals.estimatedSavingsUsd),
      detail: '전체 기간 동안 로컬 최적화가 줄인 추정 비용',
      tone: 'savings',
    },
    {
      id: 'token_reduction',
      label: '누적 절감 토큰',
      value: formatTokenCount(dashboard.totals.tokenReduction),
      detail: '전체 기간 동안 원문 그대로 보냈을 때보다 줄인 입력량',
      tone: 'savings',
    },
  ];
}

export function getUsageComparisonCards(
  dashboard: UsageDashboardResult,
): UsageComparisonCard[] {
  return [
    {
      id: 'without_optimization',
      eyebrow: '최적화 전',
      title: '로컬 최적화 없이 보냈다면',
      body: '한국어 원문이 그대로 클라우드 입력으로 들어가 더 긴 토큰 흐름과 더 높은 추정 비용이 발생합니다.',
      inputTokensLabel: formatTokenCount(dashboard.comparison.withoutOptimization.inputTokens),
      costLabel: formatUsd(dashboard.comparison.withoutOptimization.estimatedCostUsd),
      tone: 'warning',
    },
    {
      id: 'with_optimization',
      eyebrow: '로컬 최적화 후',
      title: '로컬 최적화를 적용하면',
      body: '의도, 조건, 고유명사를 유지한 더 짧은 영어 토큰 흐름으로 클라우드 입력을 줄입니다.',
      inputTokensLabel: formatTokenCount(dashboard.comparison.withOptimization.inputTokens),
      costLabel: formatUsd(dashboard.comparison.withOptimization.estimatedCostUsd),
      tone: 'success',
    },
  ];
}

export function getUsageProofLabel(dashboard: UsageDashboardResult) {
  if (dashboard.pricingBasis.status === 'empty') {
    return '이번 달 아직 기록이 없어 비교 절감 근거를 준비 중입니다';
  }

  if (dashboard.pricingBasis.status === 'mixed') {
    return `이번 달 기록에 서로 다른 요금 기준이 섞여 있어 한 번의 절감 근거로 합치지 않았습니다`;
  }

  return `이번 달 ${dashboard.totals.requestCount}건에서 ${dashboard.totals.tokenReduction.toLocaleString('ko-KR')} 토큰, ${dashboard.totals.estimatedSavingsUsd.toFixed(2)}달러를 줄였습니다`;
}

export function getUsageCumulativeLabel(dashboard: UsageDashboardResult) {
  if (dashboard.pricingBasis.status === 'mixed') {
    return '누적 기록에 서로 다른 요금 기준이 섞여 있어 한 번의 누적 절감액으로 합치지 않았습니다';
  }

  return `지금까지 ${dashboard.totals.requestCount}건에서 ${dashboard.totals.tokenReduction.toLocaleString('ko-KR')} 토큰, ${dashboard.totals.estimatedSavingsUsd.toFixed(2)}달러를 누적 절감했습니다`;
}
