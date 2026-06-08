import type {
  HistoryEntryResult,
  HistoryFeedItem,
  HistoryFeedResult,
  OptimizationMode,
} from '../../shared/ipc/contracts';

type HistoryUsageCard = {
  id: 'baseline_tokens' | 'optimized_tokens' | 'output_tokens' | 'savings_rate';
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'savings';
};

export type HistoryArtifactSection = {
  id: 'final_response_ko' | 'source_prompt_ko' | 'optimized_prompt_en' | 'provider_response_en';
  label: string;
  body: string;
  tokenLabel: string | null;
  visibility: 'default' | 'advanced';
  tone: 'result' | 'source' | 'advanced';
};

export type HistoryAdvancedReveal = {
  id: 'optimized_prompt_en' | 'provider_response_en';
  label: string;
  helper: string;
  expanded: boolean;
};

export const historyInspectionCopy = {
  sectionKicker: '절감 히스토리',
  sectionTitle: '저장된 실행 근거를 최종 응답 중심으로 살펴봅니다',
  sectionBody:
    '목록에서는 최종 한국어 응답만 빠르게 훑고, 필요할 때만 최적화 영어 프롬프트와 중간 영어 응답을 펼쳐 근거를 확인합니다.',
  listTitle: '최근 실행 인박스',
  listBody: '최종 한국어 응답이 먼저 보이도록 정리한 run 목록입니다.',
  detailTitle: '선택한 실행 근거',
  detailBody:
    '원문 한국어와 최종 응답은 바로 읽히게 두고, 영어 기반 artifact는 명시적으로 펼칠 때만 노출합니다.',
  emptyTitle: '아직 살펴볼 실행 근거가 없습니다',
  emptyBody:
    '채팅에서 첫 한국어 요청을 완료하면, 이 영역에 최종 응답 중심 히스토리와 토큰 절감 근거가 함께 쌓입니다.',
  finalResponseLabel: '최종 한국어 응답',
  sourcePromptLabel: '저장된 한국어 원문',
  optimizedPromptLabel: '최적화 영어 프롬프트',
  providerResponseLabel: '클라우드 영어 응답',
  revealOptimizedHelper: '클라우드에 전달된 영어 입력을 그대로 확인합니다.',
  revealProviderHelper: '복원 전에 받은 영어 응답을 그대로 확인합니다.',
  estimatedFootnote: '일부 토큰 수는 provider 보고 대신 로컬 추정치입니다.',
};

export const previewHistoryFeed: HistoryFeedResult = {
  items: [
    {
      runId: 'preview-run-001',
      taskId: 'task-002',
      title: '40페이지 리서치 요약',
      finalResponsePreview:
        '핵심 수치와 리스크를 유지한 채, 한국 시장 진출 전략을 7개 항목으로 압축한 요약본입니다.',
      model: 'gpt-4.1',
      mode: 'long_context',
      completedAt: '2026-06-08T02:24:00.000Z',
      savingsRate: 41,
      tokenReduction: 1880,
    },
    {
      runId: 'preview-run-002',
      taskId: 'task-001',
      title: '신규 파트너 제안서 초안',
      finalResponsePreview:
        '시장 진입 전략이 먼저 읽히도록 제안서 구조를 재배열하고, 각 장의 핵심 질문까지 붙였습니다.',
      model: 'claude-sonnet-4',
      mode: 'quality',
      completedAt: '2026-06-07T18:10:00.000Z',
      savingsRate: 39,
      tokenReduction: 484,
    },
  ],
};

export const previewHistoryEntries: Record<string, HistoryEntryResult> = {
  'preview-run-001': {
    runId: 'preview-run-001',
    taskId: 'task-002',
    title: '40페이지 리서치 요약',
    model: 'gpt-4.1',
    mode: 'long_context',
    completedAt: '2026-06-08T02:24:00.000Z',
    sourcePromptKo: {
      content:
        '긴 PDF를 바탕으로 한국 시장 진출 전략을 7개 항목으로 요약해 주세요.\n핵심 수치, 리스크, 체크리스트는 빠뜨리지 마세요.',
      tokenEstimate: 3120,
    },
    optimizedPromptEn: {
      content:
        'Summarize the PDF into 7 bullets for a Korea market-entry strategy. Preserve numeric evidence, risks, and checklist structure.',
      tokenEstimate: 1240,
    },
    providerResponseEn: {
      content:
        '1. Market timing: Demand is rising in SMB support automation.\n2. Key metric: CAC dropped 18% in pilot regions.\n3. Risk: Localization backlog may delay rollout.\n- [ ] Keep the launch checklist visible.',
      tokenEstimate: 402,
    },
    finalResponseKo: {
      content:
        '1. 시장 진입 시점: SMB 지원 자동화 수요가 올라가고 있습니다.\n2. 핵심 수치: 파일럿 지역에서 CAC가 18% 감소했습니다.\n3. 리스크: 현지화 백로그가 출시 일정을 늦출 수 있습니다.\n- [ ] 출시 체크리스트를 유지하세요.',
      tokenEstimate: 438,
    },
    usage: {
      baselineInputTokens: 3120,
      optimizedInputTokens: 1240,
      outputTokens: 402,
      tokenReduction: 1880,
      savingsRate: 60,
      estimatedSavingsUsd: 4.51,
      pricingVersion: 'openai-gpt-4.1-2026-06',
      isEstimated: false,
    },
  },
  'preview-run-002': {
    runId: 'preview-run-002',
    taskId: 'task-001',
    title: '신규 파트너 제안서 초안',
    model: 'claude-sonnet-4',
    mode: 'quality',
    completedAt: '2026-06-07T18:10:00.000Z',
    sourcePromptKo: {
      content: '시장 진입 전략이 먼저 읽히도록 제안서 목차를 다시 짜고, 각 장의 핵심 질문도 붙여 주세요.',
      tokenEstimate: 1240,
    },
    optimizedPromptEn: {
      content:
        'Rewrite the proposal outline so market entry strategy appears first. Add one guiding question per section.',
      tokenEstimate: 756,
    },
    providerResponseEn: {
      content:
        '1. Market Entry Thesis\n2. Target Segment and Pain\n3. Pilot Rollout Plan\n4. Pricing Narrative\n5. Partnership Ask',
      tokenEstimate: 488,
    },
    finalResponseKo: {
      content:
        '1. 시장 진입 가설\n2. 타깃 세그먼트와 문제 정의\n3. 파일럿 롤아웃 계획\n4. 가격 정책 서사\n5. 파트너십 제안',
      tokenEstimate: 522,
    },
    usage: {
      baselineInputTokens: 1240,
      optimizedInputTokens: 756,
      outputTokens: 488,
      tokenReduction: 484,
      savingsRate: 39,
      estimatedSavingsUsd: 1.16,
      pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
      isEstimated: false,
    },
  },
};

const tokenFormatter = new Intl.NumberFormat('ko-KR');
const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function getHistoryModeLabel(mode: OptimizationMode) {
  switch (mode) {
    case 'balanced':
      return '기본';
    case 'savings':
      return '절감 우선';
    case 'quality':
      return '품질 우선';
    case 'long_context':
      return '긴 컨텍스트';
  }
}

function formatTokenCount(value: number) {
  return `${tokenFormatter.format(value)} 토큰`;
}

function formatUsd(value: number) {
  return usdFormatter.format(value);
}

export function formatHistoryTimestamp(value: string | null) {
  if (!value) {
    return '저장 시각 대기 중';
  }

  return dateTimeFormatter.format(new Date(value));
}

export function getHistoryListMeta(item: HistoryFeedItem) {
  return `${item.model} · ${getHistoryModeLabel(item.mode)} · ${item.savingsRate}% 절감`;
}

export function getHistoryUsageCards(entry: HistoryEntryResult): HistoryUsageCard[] {
  return [
    {
      id: 'baseline_tokens',
      label: '원문 입력',
      value: formatTokenCount(entry.usage.baselineInputTokens),
      detail: '저장된 한국어 원문 기준 입력 토큰',
      tone: 'neutral',
    },
    {
      id: 'optimized_tokens',
      label: '최적화 입력',
      value: formatTokenCount(entry.usage.optimizedInputTokens),
      detail: '클라우드로 전달된 영어 입력 토큰',
      tone: 'neutral',
    },
    {
      id: 'output_tokens',
      label: '클라우드 출력',
      value: formatTokenCount(entry.usage.outputTokens),
      detail: '영어 응답 기준 출력 토큰',
      tone: 'neutral',
    },
    {
      id: 'savings_rate',
      label: '이번 run 절감',
      value: `${entry.usage.savingsRate}%`,
      detail: `${formatTokenCount(entry.usage.tokenReduction)} 감소 · ${formatUsd(entry.usage.estimatedSavingsUsd)} 절감`,
      tone: 'savings',
    },
  ];
}

export function getHistoryArtifactSections(
  entry: HistoryEntryResult,
  visibility: {
    showOptimizedPrompt: boolean;
    showProviderResponse: boolean;
  },
): HistoryArtifactSection[] {
  const sections: HistoryArtifactSection[] = [
    {
      id: 'final_response_ko',
      label: historyInspectionCopy.finalResponseLabel,
      body: entry.finalResponseKo.content,
      tokenLabel:
        entry.finalResponseKo.tokenEstimate !== null
          ? `복원 응답 길이 ${formatTokenCount(entry.finalResponseKo.tokenEstimate)}`
          : null,
      visibility: 'default',
      tone: 'result',
    },
    {
      id: 'source_prompt_ko',
      label: historyInspectionCopy.sourcePromptLabel,
      body: entry.sourcePromptKo.content,
      tokenLabel: formatTokenCount(entry.usage.baselineInputTokens),
      visibility: 'default',
      tone: 'source',
    },
  ];

  if (visibility.showOptimizedPrompt && entry.optimizedPromptEn) {
    sections.push({
      id: 'optimized_prompt_en',
      label: historyInspectionCopy.optimizedPromptLabel,
      body: entry.optimizedPromptEn.content,
      tokenLabel: formatTokenCount(entry.usage.optimizedInputTokens),
      visibility: 'advanced',
      tone: 'advanced',
    });
  }

  if (visibility.showProviderResponse && entry.providerResponseEn) {
    sections.push({
      id: 'provider_response_en',
      label: historyInspectionCopy.providerResponseLabel,
      body: entry.providerResponseEn.content,
      tokenLabel: formatTokenCount(entry.usage.outputTokens),
      visibility: 'advanced',
      tone: 'advanced',
    });
  }

  return sections;
}

export function getHistoryAdvancedReveals(
  entry: HistoryEntryResult,
  visibility: {
    showOptimizedPrompt: boolean;
    showProviderResponse: boolean;
  },
): HistoryAdvancedReveal[] {
  const reveals: HistoryAdvancedReveal[] = [];

  if (entry.optimizedPromptEn) {
    reveals.push({
      id: 'optimized_prompt_en',
      label: visibility.showOptimizedPrompt
        ? '최적화 영어 프롬프트 접기'
        : '최적화 영어 프롬프트 펼치기',
      helper: historyInspectionCopy.revealOptimizedHelper,
      expanded: visibility.showOptimizedPrompt,
    });
  }

  if (entry.providerResponseEn) {
    reveals.push({
      id: 'provider_response_en',
      label: visibility.showProviderResponse
        ? '클라우드 영어 응답 접기'
        : '클라우드 영어 응답 펼치기',
      helper: historyInspectionCopy.revealProviderHelper,
      expanded: visibility.showProviderResponse,
    });
  }

  return reveals;
}
