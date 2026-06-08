import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUsageRecordInput } from '../src/main/workflows/run-helpers.ts';

function roundUsd(value: number) {
  return Number(value.toFixed(6));
}

test('story-4.1:VAL-1 and story-4.1:AC-2 calculate per-run savings against one versioned provider/model price table', () => {
  const record = buildUsageRecordInput({
    id: 'usage-sample',
    runId: 'run-sample',
    model: 'gpt-4.1',
    provider: 'openai',
    sourceKorean:
      [
        '고객 지원 운영 계획 초안을 길게 정리해줘.',
        '현재 상태, 병목, 다음 단계, 담당자 메모를 모두 유지해줘.',
        '숫자 42와 Talkin AI 고유명사를 그대로 남기고 체크리스트 형식으로 답해줘.',
      ].join(' '),
    optimizedEnglish:
      'Write a support handoff checklist. Keep 42 and Talkin AI.',
    responseEnglish:
      '1. Keep the 42 metric visible.\n2. Preserve the Talkin AI name.\n- [ ] Review the checklist.',
    latencyMs: 731,
  });

  assert.equal(record.pricingVersion, 'openai-gpt-4.1-2026-06');
  assert.equal(record.isEstimated, true);
  assert.equal(record.latencyMs, 731);
  assert.equal(
    record.estimatedCostWithoutOptimization,
    roundUsd((record.baselineInputTokens / 1_000) * 0.002 + (record.outputTokens / 1_000) * 0.008),
  );
  assert.equal(
    record.estimatedCostWithOptimization,
    roundUsd((record.optimizedInputTokens / 1_000) * 0.002 + (record.outputTokens / 1_000) * 0.008),
  );
  assert.ok(record.estimatedCostWithoutOptimization > record.estimatedCostWithOptimization);
});

test('story-4.1:VAL-2 and story-4.1:SCOPE-2 prefer provider-reported usage when it is available', () => {
  const record = buildUsageRecordInput({
    id: 'usage-provider',
    runId: 'run-provider',
    model: 'gpt-4.1',
    provider: 'openai',
    sourceKorean: '고객 지원 상태를 요약해줘.',
    optimizedEnglish: 'Summarize the customer support status.',
    responseEnglish: 'Support summary ready.',
    latencyMs: 412,
    reportedUsage: {
      inputTokens: 84,
      outputTokens: 28,
      totalTokens: 112,
    },
  });

  assert.equal(record.optimizedInputTokens, 84);
  assert.equal(record.outputTokens, 28);
  assert.equal(record.isEstimated, false);
  assert.equal(
    record.estimatedCostWithOptimization,
    roundUsd((84 / 1_000) * 0.002 + (28 / 1_000) * 0.008),
  );
});

test('story-4.1:VAL-3 rejects mixed provider/model pricing comparisons', () => {
  assert.throws(
    () =>
      buildUsageRecordInput({
        id: 'usage-mismatch',
        runId: 'run-mismatch',
        model: 'gpt-4.1',
        provider: 'anthropic',
        sourceKorean: '모델 가격 비교를 검증해줘.',
        optimizedEnglish: 'Validate the model pricing comparison.',
        responseEnglish: 'Comparison failed.',
        latencyMs: 120,
      }),
    /expects provider openai, received anthropic/,
  );
});
