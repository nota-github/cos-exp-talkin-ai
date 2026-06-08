import type { CloudModelId } from '../../shared/ipc/contracts';
import type { ProviderId } from '../persistence/index.ts';
import type {
  CreateUsageRecordInput,
  RunRecord,
} from '../persistence/index.ts';
import type { CloudInferenceUsage } from '../providers/index.ts';
import type { TranslationPreservationInput } from '../translation/index.ts';

const pricingByModel: Record<
  CloudModelId,
  {
    provider: ProviderId;
    pricingVersion: string;
    inputCostPer1kTokensUsd: number;
    outputCostPer1kTokensUsd: number;
  }
> = {
  'gpt-4.1': {
    provider: 'openai',
    pricingVersion: 'openai-gpt-4.1-2026-06',
    inputCostPer1kTokensUsd: 0.002,
    outputCostPer1kTokensUsd: 0.008,
  },
  'claude-sonnet-4': {
    provider: 'anthropic',
    pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
    inputCostPer1kTokensUsd: 0.003,
    outputCostPer1kTokensUsd: 0.015,
  },
  'gemini-1.5-pro': {
    provider: 'google',
    pricingVersion: 'google-gemini-1.5-pro-2026-06',
    inputCostPer1kTokensUsd: 0.00125,
    outputCostPer1kTokensUsd: 0.005,
  },
};

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function roundUsd(value: number) {
  return Number(value.toFixed(6));
}

export function estimateTokenCount(content: string) {
  const normalized = content.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function extractNamedEntities(sourceKorean: string) {
  const latinEntityMatches =
    sourceKorean.match(/[A-Za-z][A-Za-z0-9.+-]*(?:\s+[A-Za-z][A-Za-z0-9.+-]*)*/g) ?? [];

  return uniqueValues(latinEntityMatches).slice(0, 12);
}

function extractRequiredConstraints(sourceKorean: string) {
  const lines = sourceKorean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const constraintHints = [
    '유지',
    '보존',
    '그대로',
    '반드시',
    '꼭',
    '빠뜨리지',
    '형식',
    '출력',
    '표',
    '체크리스트',
    '목차',
    '번호',
    '리스트',
  ];

  const matchedLines = lines.filter((line) =>
    constraintHints.some((hint) => line.includes(hint)),
  );

  return uniqueValues(matchedLines).slice(0, 12);
}

function detectOutputFormat(sourceKorean: string) {
  if (/마크다운|markdown/i.test(sourceKorean) && /체크리스트/.test(sourceKorean)) {
    return 'markdown checklist';
  }

  if (/체크리스트/.test(sourceKorean)) {
    return 'checklist';
  }

  if (/표/.test(sourceKorean)) {
    return 'table';
  }

  if (/목차|헤딩|제목/.test(sourceKorean)) {
    return 'heading outline';
  }

  if (/번호\s*목록|번호\s*리스트|번호\s*순서/.test(sourceKorean)) {
    return 'numbered list';
  }

  return undefined;
}

function detectPreserveStructure(
  sourceKorean: string,
): TranslationPreservationInput['preserveStructure'] {
  const preserveStructure: TranslationPreservationInput['preserveStructure'] = [];

  if (/표/.test(sourceKorean) || /\|.+\|/.test(sourceKorean)) {
    preserveStructure.push('tables');
  }

  if (/체크리스트/.test(sourceKorean) || /\[[ xX]\]/.test(sourceKorean)) {
    preserveStructure.push('checklists');
  }

  if (/목차|헤딩|제목/.test(sourceKorean)) {
    preserveStructure.push('headings');
  }

  if (
    /리스트|목록|항목|불릿|번호/.test(sourceKorean) ||
    /^\s*[-*]\s/m.test(sourceKorean) ||
    /^\s*\d+\.\s/m.test(sourceKorean)
  ) {
    preserveStructure.push('lists');
  }

  return uniqueValues(preserveStructure) as TranslationPreservationInput['preserveStructure'];
}

export function buildPreservationInput(sourceKorean: string): TranslationPreservationInput {
  return {
    namedEntities: extractNamedEntities(sourceKorean),
    requiredConstraints: extractRequiredConstraints(sourceKorean),
    outputFormat: detectOutputFormat(sourceKorean),
    preserveStructure: detectPreserveStructure(sourceKorean),
    preserveNumericLiterals: /\d/.test(sourceKorean) || /숫자|수치|퍼센트|%/.test(sourceKorean),
  };
}

export function buildUsageRecordInput(input: {
  id: string;
  runId: string;
  model: RunRecord['model'];
  provider: RunRecord['provider'];
  sourceKorean: string;
  optimizedEnglish: string;
  responseEnglish: string;
  latencyMs: number;
  reportedUsage?: CloudInferenceUsage;
}): CreateUsageRecordInput {
  const pricing = pricingByModel[input.model];

  if (pricing.provider !== input.provider) {
    throw new Error(
      `Model ${input.model} pricing expects provider ${pricing.provider}, received ${input.provider}.`,
    );
  }

  const baselineInputTokens = estimateTokenCount(input.sourceKorean);
  const optimizedInputTokens =
    input.reportedUsage?.inputTokens ?? estimateTokenCount(input.optimizedEnglish);
  const outputTokens =
    input.reportedUsage?.outputTokens ?? estimateTokenCount(input.responseEnglish);
  const estimatedCostWithoutOptimization =
    (baselineInputTokens / 1_000) * pricing.inputCostPer1kTokensUsd +
    (outputTokens / 1_000) * pricing.outputCostPer1kTokensUsd;
  const estimatedCostWithOptimization =
    (optimizedInputTokens / 1_000) * pricing.inputCostPer1kTokensUsd +
    (outputTokens / 1_000) * pricing.outputCostPer1kTokensUsd;

  return {
    id: input.id,
    runId: input.runId,
    baselineInputTokens,
    optimizedInputTokens,
    outputTokens,
    estimatedCostWithoutOptimization: roundUsd(estimatedCostWithoutOptimization),
    estimatedCostWithOptimization: roundUsd(estimatedCostWithOptimization),
    pricingVersion: pricing.pricingVersion,
    latencyMs: Math.max(0, Math.floor(input.latencyMs)),
  };
}
