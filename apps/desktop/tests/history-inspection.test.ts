import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPersistentHistoryInspectionService } from '../src/main/history/index.ts';
import {
  createChatRunPersistence,
  migrateDesktopSchema,
  openSqliteDatabase,
  type ChatRunPersistence,
} from '../src/main/persistence/index.ts';
import {
  getHistoryAdvancedReveals,
  getHistoryArtifactSections,
  getHistoryListMeta,
  previewHistoryEntries,
} from '../src/renderer/routes/history-surface.ts';

const usageRouteSource = readFileSync(new URL('../src/renderer/routes/UsageRoute.tsx', import.meta.url), 'utf8');
const historySurfaceSource = readFileSync(new URL('../src/renderer/routes/history-surface.ts', import.meta.url), 'utf8');
const queryClientSource = readFileSync(new URL('../src/renderer/lib/ipc/query-client.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

type TempHistoryHarness = {
  dbPath: string;
  cleanup(): Promise<void>;
  persistence: ChatRunPersistence;
};

async function createTempHistoryHarness(): Promise<TempHistoryHarness> {
  const directory = mkdtempSync(join(tmpdir(), 'talkin-ai-history-inspection-'));
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

async function insertCompletedHistoryRun(
  persistence: ChatRunPersistence,
  input: {
    suffix: string;
    title: string;
    startedAt: string;
    endedAt: string;
    mode: 'balanced' | 'savings' | 'quality' | 'long_context';
    model: 'gpt-4.1' | 'claude-sonnet-4' | 'gemini-1.5-pro';
    provider: 'openai' | 'anthropic' | 'google';
    pricingVersion: string;
    promptKo: string;
    optimizedPromptEn: string;
    providerResponseEn: string;
    finalResponseKo: string;
    baselineTokens: number;
    optimizedTokens: number;
    outputTokens: number;
    withoutCostUsd: number;
    withCostUsd: number;
  },
) {
  const taskId = `task-${input.suffix}`;
  const conversationId = `conversation-${input.suffix}`;
  const messageId = `message-${input.suffix}`;
  const runId = `run-${input.suffix}`;

  await persistence.tasks.create({
    id: taskId,
    title: input.title,
    status: 'completed',
    projectId: null,
    sourceScreen: 'chat',
    usageCategory: 'general',
    createdAt: input.startedAt,
    updatedAt: input.endedAt,
    lastActivityAt: input.endedAt,
  });

  await persistence.conversations.create({
    id: conversationId,
    taskId,
    summary: input.title,
    mode: input.mode,
    selectedModel: input.model,
    createdAt: input.startedAt,
    updatedAt: input.endedAt,
  });

  await persistence.messages.create({
    id: messageId,
    conversationId,
    role: 'user',
    contentKo: input.promptKo,
    runId,
    createdAt: input.startedAt,
  });

  await persistence.runRecords.create({
    id: runId,
    taskId,
    conversationId,
    messageId,
    status: 'completed',
    provider: input.provider,
    model: input.model,
    mode: input.mode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    errorCode: null,
  });

  await persistence.promptArtifacts.create({
    id: `artifact-optimized-${input.suffix}`,
    runId,
    artifactType: 'optimized_prompt_en',
    content: input.optimizedPromptEn,
    tokenEstimate: input.optimizedTokens,
    visibility: 'advanced',
  });
  await persistence.promptArtifacts.create({
    id: `artifact-provider-${input.suffix}`,
    runId,
    artifactType: 'provider_response_en',
    content: input.providerResponseEn,
    tokenEstimate: input.outputTokens,
    visibility: 'advanced',
  });
  await persistence.promptArtifacts.create({
    id: `artifact-final-${input.suffix}`,
    runId,
    artifactType: 'restored_response_ko',
    content: input.finalResponseKo,
    tokenEstimate: input.outputTokens + 28,
    visibility: 'default',
  });

  await persistence.messages.create({
    id: `assistant-${input.suffix}`,
    conversationId,
    role: 'assistant',
    contentKo: input.finalResponseKo,
    runId,
    createdAt: input.endedAt,
  });

  await persistence.usageRecords.create({
    id: `usage-${input.suffix}`,
    runId,
    baselineInputTokens: input.baselineTokens,
    optimizedInputTokens: input.optimizedTokens,
    outputTokens: input.outputTokens,
    estimatedCostWithoutOptimization: input.withoutCostUsd,
    estimatedCostWithOptimization: input.withCostUsd,
    pricingVersion: input.pricingVersion,
    latencyMs: 910,
    isEstimated: false,
  });

  return { runId };
}

test('story-4.4:VAL-1, story-4.4:AC-1, and story-4.4:AC-3 read persisted source, optimized, final, and savings evidence without reconstruction', async () => {
  const temp = await createTempHistoryHarness();
  const service = createPersistentHistoryInspectionService({
    dbPath: temp.dbPath,
  });
  const latestPromptKo =
    '해외 운영 이슈를 반영해서 한국 시장 진출 전략 메모를 다시 정리해 주세요.\n표와 체크리스트는 유지해 주세요.';
  const latestOptimizedEn =
    'Rewrite the Korea market-entry memo with overseas ops risks included. Preserve table and checklist structure.';
  const latestProviderEn =
    '| Theme | Detail |\n| --- | --- |\n| Risk | Overseas support coverage is thin |\n- [ ] Keep the rollout checklist visible.';
  const latestFinalKo =
    '| 항목 | 내용 |\n| --- | --- |\n| 리스크 | 해외 운영 지원 범위가 얇습니다 |\n- [ ] 롤아웃 체크리스트를 유지하세요.';

  try {
    await insertCompletedHistoryRun(temp.persistence, {
      suffix: 'older',
      title: '이전 운영 공지 정리',
      startedAt: '2026-06-05T08:00:00.000Z',
      endedAt: '2026-06-05T08:06:00.000Z',
      mode: 'balanced',
      model: 'gpt-4.1',
      provider: 'openai',
      pricingVersion: 'openai-gpt-4.1-2026-06',
      promptKo: '이전 공지 문장을 부드럽게 다듬어 주세요.',
      optimizedPromptEn: 'Polish the earlier operations notice with a softer tone.',
      providerResponseEn: '1. Smoother tone.\n2. Keep deadline visible.',
      finalResponseKo: '1. 문장을 부드럽게 다듬었습니다.\n2. 마감 일정은 그대로 남겼습니다.',
      baselineTokens: 820,
      optimizedTokens: 510,
      outputTokens: 120,
      withoutCostUsd: 0.98,
      withCostUsd: 0.61,
    });
    const latestRun = await insertCompletedHistoryRun(temp.persistence, {
      suffix: 'latest',
      title: '해외 운영 변수 반영 메모',
      startedAt: '2026-06-08T09:10:00.000Z',
      endedAt: '2026-06-08T09:18:00.000Z',
      mode: 'quality',
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
      promptKo: latestPromptKo,
      optimizedPromptEn: latestOptimizedEn,
      providerResponseEn: latestProviderEn,
      finalResponseKo: latestFinalKo,
      baselineTokens: 1880,
      optimizedTokens: 1120,
      outputTokens: 244,
      withoutCostUsd: 2.31,
      withCostUsd: 1.44,
    });

    const feed = await service.getHistoryFeed({});
    const detail = await service.getHistoryEntry({
      runId: latestRun.runId,
    });

    assert.equal(feed.items.length, 2);
    assert.equal(feed.items[0]?.runId, latestRun.runId);
    assert.match(feed.items[0]?.finalResponsePreview ?? '', /해외 운영 지원 범위가 얇습니다/);
    assert.equal(detail.runId, latestRun.runId);
    assert.equal(detail.title, '해외 운영 변수 반영 메모');
    assert.equal(detail.sourcePromptKo.content, latestPromptKo);
    assert.equal(detail.optimizedPromptEn?.content, latestOptimizedEn);
    assert.equal(detail.providerResponseEn?.content, latestProviderEn);
    assert.equal(detail.finalResponseKo.content, latestFinalKo);
    assert.deepEqual(detail.usage, {
      baselineInputTokens: 1880,
      optimizedInputTokens: 1120,
      outputTokens: 244,
      tokenReduction: 760,
      savingsRate: 40,
      estimatedSavingsUsd: 0.87,
      pricingVersion: 'anthropic-claude-sonnet-4-2026-06',
      isEstimated: false,
    });
  } finally {
    await temp.cleanup();
  }
});

test('story-4.4:VAL-2, story-4.4:AC-2, and story-4.4:AC-6 keep advanced artifacts collapsed until explicitly expanded', () => {
  const entry = previewHistoryEntries['preview-run-001'];

  const collapsedSections = getHistoryArtifactSections(entry, {
    showOptimizedPrompt: false,
    showProviderResponse: false,
  });
  const collapsedReveals = getHistoryAdvancedReveals(entry, {
    showOptimizedPrompt: false,
    showProviderResponse: false,
  });
  const expandedSections = getHistoryArtifactSections(entry, {
    showOptimizedPrompt: true,
    showProviderResponse: true,
  });
  const expandedReveals = getHistoryAdvancedReveals(entry, {
    showOptimizedPrompt: true,
    showProviderResponse: true,
  });

  assert.deepEqual(
    collapsedSections.map((section) => section.id),
    ['final_response_ko', 'source_prompt_ko'],
  );
  assert.deepEqual(
    collapsedReveals.map((reveal) => [reveal.id, reveal.expanded]),
    [
      ['optimized_prompt_en', false],
      ['provider_response_en', false],
    ],
  );
  assert.deepEqual(
    expandedSections.map((section) => section.id),
    ['final_response_ko', 'source_prompt_ko', 'optimized_prompt_en', 'provider_response_en'],
  );
  assert.deepEqual(
    expandedReveals.map((reveal) => [reveal.id, reveal.expanded]),
    [
      ['optimized_prompt_en', true],
      ['provider_response_en', true],
    ],
  );
  assert.match(usageRouteSource, /aria-expanded=\{reveal\.expanded\}/);
  assert.match(usageRouteSource, /setShowOptimizedPrompt/);
  assert.match(usageRouteSource, /setShowProviderResponse/);
});

test('story-4.4:VAL-3, story-4.4:AC-4, and story-4.4:AC-5 keep the list final-response-first and the detail evidence-led', () => {
  const item = {
    runId: 'preview-run-001',
    taskId: 'task-002',
    title: '40페이지 리서치 요약',
    finalResponsePreview:
      '핵심 수치와 리스크를 유지한 채, 한국 시장 진출 전략을 7개 항목으로 압축한 요약본입니다.',
    model: 'gpt-4.1',
    mode: 'long_context' as const,
    completedAt: '2026-06-08T02:24:00.000Z',
    savingsRate: 41,
    tokenReduction: 1880,
  };

  assert.equal(
    getHistoryListMeta(item),
    'gpt-4.1 · 긴 컨텍스트 · 41% 절감',
  );
  assert.match(usageRouteSource, /getHistoryFeed/);
  assert.match(usageRouteSource, /item\.finalResponsePreview/);
  assert.match(usageRouteSource, /usage-history-panel/);
  assert.match(usageRouteSource, /usage-history-reveal-button/);
  assert.match(historySurfaceSource, /최종 응답 중심/);
  assert.doesNotMatch(historySurfaceSource, /debug log/i);
  assert.doesNotMatch(historySurfaceSource, /provider debug/i);
  assert.match(queryClientSource, /historyFeed:\s*'getHistoryFeed'/);
  assert.match(queryClientSource, /run:\s*\['getHistoryFeed', 'getHistoryEntry'\]/);
  assert.match(stylesSource, /\.usage-history-layout\s*\{/);
  assert.match(stylesSource, /\.usage-history-row-active\s*\{/);
  assert.match(stylesSource, /\.usage-history-artifact-card-advanced\s*\{/);
});
