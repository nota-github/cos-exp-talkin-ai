import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  chatStarterCards,
  chatSurfaceCopy,
  continueTaskInWorkbench,
  createStarterDraftSelection,
  getChatResponseMetadata,
  getChatRunFeedback,
  getChatDraftPreview,
  getRunFeedbackActionLabel,
  mergeVisibleConversationMessages,
  resolveSourceMessageForRun,
  submitChatPromptDraft,
} from '../src/renderer/routes/chat-surface.ts';

const chatRouteSource = readFileSync(new URL('../src/renderer/routes/ChatRoute.tsx', import.meta.url), 'utf8');
const chatStylesSource = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

test('story-2.1:VAL-1 first-screen copy explains product purpose and the first Korean action', () => {
  assert.equal(chatSurfaceCopy.headline, '무엇이든 한국어로 편하게 물어보세요');
  assert.match(chatSurfaceCopy.intro, /로컬 최적화 엔진/);
  assert.match(chatSurfaceCopy.recentInboxEmptyBody, /starter를 누르거나 아래 입력창에 첫 한국어 요청을 적어 보세요/);
  assert.equal(chatSurfaceCopy.primaryCta, '한국어 요청 시작하기');
});

test('story-2.1:AC-2 and story-2.1:VAL-2 starter cards cover the required examples and fill the composer draft', () => {
  assert.deepEqual(
    chatStarterCards.map((card) => card.eyebrow),
    ['사업계획서 초안', '긴 PDF 요약', '카피 다듬기'],
  );

  const selection = createStarterDraftSelection(chatStarterCards[1]);

  assert.equal(selection.activeStarterId, 'pdf-summary');
  assert.equal(selection.promptDraft, '긴 PDF 핵심만 7개 항목으로 요약해줘');
  assert.deepEqual(selection.submitState, {
    status: 'idle',
    message: null,
  });
  assert.equal(getChatDraftPreview(''), chatSurfaceCopy.draftPreviewEmpty);
  assert.equal(getChatDraftPreview(selection.promptDraft), selection.promptDraft);
});

test('story-2.1:AC-3 and story-2.1:VAL-3 keep the inbox shell, composer controls, and desktop layout split in source', () => {
  assert.match(chatRouteSource, /className="chat-inbox-shell"/);
  assert.match(chatRouteSource, /modelOptions\.map/);
  assert.match(chatRouteSource, /optimizationModeOptions\.map/);
  assert.match(chatRouteSource, /<textarea/);
  assert.match(chatStylesSource, /\.chat-inbox-shell\s*\{/);
  assert.match(
    chatStylesSource,
    /grid-template-columns:\s*minmax\(320px,\s*0\.88fr\)\s*minmax\(0,\s*1\.45fr\);/,
  );
});

test('story-2.2:AC-2 and story-2.2:AC-6 successful local save keeps the exact Korean draft visible until feed refresh', async () => {
  const promptDraft = '\n첫 줄을 그대로 남겨 주세요.\n둘째 줄과 표 항목도 유지해 주세요.\n';
  let observedPromptKo = '';

  const outcome = await submitChatPromptDraft({
    activeStarterId: 'business-plan',
    now: () => '2026-06-08T02:20:00.000Z',
    optimizationMode: 'long_context',
    promptDraft,
    selectedModel: 'claude-sonnet-4',
    submitPrompt: async (request) => {
      observedPromptKo = request.promptKo;

      return {
        taskId: 'task-101',
        conversationId: 'conv-101',
        messageId: 'msg-101',
        runId: 'run-101',
        acceptedStatus: 'queued',
      };
    },
  });

  assert.equal(observedPromptKo, promptDraft);
  assert.equal(outcome.promptDraft, '');
  assert.equal(outcome.activeStarterId, null);
  assert.deepEqual(outcome.pendingSubmission, {
    messageId: 'msg-101',
    conversationId: 'conv-101',
    runId: 'run-101',
    role: 'user',
    contentKo: promptDraft,
    createdAt: '2026-06-08T02:20:00.000Z',
  });
  assert.deepEqual(mergeVisibleConversationMessages([], outcome.pendingSubmission), [
    outcome.pendingSubmission,
  ]);
  assert.deepEqual(outcome.submitState, {
    status: 'success',
    message: chatSurfaceCopy.submitSavedMessage,
  });
});

test('story-2.2:AC-4 and story-2.2:VAL-3 failed local save keeps the Korean draft and returns safe error copy', async () => {
  const promptDraft = '실패 후에도 이 한국어 draft는 그대로 남아 있어야 합니다.\n체크리스트도 유지해 주세요.';

  const outcome = await submitChatPromptDraft({
    activeStarterId: 'pdf-summary',
    optimizationMode: 'quality',
    promptDraft,
    selectedModel: 'gpt-4.1',
    submitPrompt: async () => {
      throw new Error('forced local write failure');
    },
  });

  assert.equal(outcome.promptDraft, promptDraft);
  assert.equal(outcome.activeStarterId, 'pdf-summary');
  assert.equal(outcome.pendingSubmission, null);
  assert.deepEqual(outcome.submitState, {
    status: 'error',
    message: chatSurfaceCopy.submitFailureMessage,
  });
});

test('story-5.5:SCOPE-3 deep-linked chat continuation keeps submitting into the selected conversation', async () => {
  let observedConversationId: string | undefined;

  await submitChatPromptDraft({
    activeStarterId: null,
    conversationId: 'conv-401',
    optimizationMode: 'quality',
    promptDraft: '이 대화에서 바로 이어서 수정해줘.',
    selectedModel: 'claude-sonnet-4',
    submitPrompt: async (request) => {
      observedConversationId = request.conversationId;

      return {
        taskId: 'task-401',
        conversationId: 'conv-401',
        messageId: 'msg-401',
        runId: 'run-401',
        acceptedStatus: 'queued',
      };
    },
  });

  assert.equal(observedConversationId, 'conv-401');
  assert.match(chatRouteSource, /useSearchParams/);
  assert.match(
    chatRouteSource,
    /conversationId: chatFeedQuery\.data\?\.activeConversationId \?\? requestedConversationId/,
  );
});

test('story-2.2:AC-5 and story-2.2:AC-6 source switches the stage from landing guide to conversation feed with preserved multiline bubbles', () => {
  assert.match(chatRouteSource, /conversationMessages\.map/);
  assert.match(chatRouteSource, /pendingDraftPreview/);
  assert.match(chatRouteSource, /!showConversationFeed \?/);
  assert.match(chatStylesSource, /\.bubble-meta\s*\{/);
  assert.match(chatStylesSource, /white-space:\s*pre-wrap/);
});

test('story-3.5:VAL-1 and story-3.5:AC-1 stage feedback compresses optimization, model wait, and restore progress into user-facing copy', () => {
  const optimizingFeedback = getChatRunFeedback({
    runId: 'run-201',
    sourceMessageId: 'msg-201',
    status: 'optimizing',
    stage: 'optimizing',
    model: 'gpt-4.1',
    mode: 'balanced',
    errorCode: null,
    failure: null,
  });
  const cloudPendingFeedback = getChatRunFeedback({
    runId: 'run-202',
    sourceMessageId: 'msg-202',
    status: 'cloud_pending',
    stage: 'cloud_pending',
    model: 'claude-sonnet-4',
    mode: 'quality',
    errorCode: null,
    failure: null,
  });
  const restoringFeedback = getChatRunFeedback({
    runId: 'run-203',
    sourceMessageId: 'msg-203',
    status: 'restoring',
    stage: 'restoring',
    model: 'gemini-1.5-pro',
    mode: 'long_context',
    errorCode: null,
    failure: null,
  });

  assert.equal(optimizingFeedback?.badgeLabel, '로컬 최적화');
  assert.match(optimizingFeedback?.title ?? '', /영어 토큰 흐름/);
  assert.equal(optimizingFeedback?.steps[0]?.state, 'current');
  assert.equal(cloudPendingFeedback?.badgeLabel, '모델 응답 대기');
  assert.equal(cloudPendingFeedback?.steps[0]?.state, 'completed');
  assert.equal(cloudPendingFeedback?.steps[1]?.state, 'current');
  assert.equal(restoringFeedback?.badgeLabel, '한국어 복원');
  assert.equal(restoringFeedback?.steps[2]?.state, 'current');
});

test('story-3.5:VAL-2, story-3.5:AC-2, and story-3.5:AC-6 failure guidance prefers safe next actions over raw error codes', () => {
  const localFailure = getChatRunFeedback({
    runId: 'run-301',
    sourceMessageId: 'msg-301',
    status: 'failed',
    stage: 'failed',
    model: 'gpt-4.1',
    mode: 'balanced',
    errorCode: 'local_optimization_runtime_error',
    failure: {
      failedStage: 'optimizing',
      message: 'forced local optimization failure',
      guidance: null,
      retryable: true,
    },
  });
  const authFailure = getChatRunFeedback({
    runId: 'run-302',
    sourceMessageId: 'msg-302',
    status: 'failed',
    stage: 'failed',
    model: 'gpt-4.1',
    mode: 'balanced',
    errorCode: 'cloud_inference_auth',
    failure: {
      failedStage: 'cloud_pending',
      message: 'OpenAI 인증에 실패했습니다.',
      guidance: '설정에서 OpenAI API 키 연결 상태를 확인하세요.',
      retryable: false,
    },
  });
  const providerFailure = getChatRunFeedback({
    runId: 'run-303',
    sourceMessageId: 'msg-303',
    status: 'failed',
    stage: 'failed',
    model: 'claude-sonnet-4',
    mode: 'quality',
    errorCode: 'cloud_inference_rate_limit',
    failure: {
      failedStage: 'cloud_pending',
      message: 'Anthropic 요청 한도에 도달했습니다.',
      guidance: '잠시 후 다시 시도하거나 사용량 한도를 확인하세요.',
      retryable: true,
    },
  });

  assert.equal(localFailure?.title, '로컬 최적화 단계에서 멈췄습니다');
  assert.deepEqual(localFailure?.actions.map(getRunFeedbackActionLabel), ['재시도', '설정 확인']);
  assert.match(localFailure?.description ?? '', /다시 시도/);
  assert.equal(localFailure?.detail, null);
  assert.equal(authFailure?.title, '모델 응답 단계에서 멈췄습니다');
  assert.deepEqual(authFailure?.actions.map(getRunFeedbackActionLabel), ['설정 확인', '다른 모델 선택']);
  assert.equal(authFailure?.detail, '설정에서 OpenAI API 키 연결 상태를 확인하세요.');
  assert.deepEqual(providerFailure?.actions.map(getRunFeedbackActionLabel), ['재시도', '다른 모델 선택']);
  assert.match(providerFailure?.description ?? '', /다른 모델/);
});

test('story-3.5:AC-3 source exposes retry, settings, and same-prompt model-switch actions without a log-panel layout', () => {
  const sourceMessage = resolveSourceMessageForRun(
    [
      {
        messageId: 'msg-401',
        conversationId: 'conv-401',
        runId: 'run-401',
        role: 'user',
        contentKo: '같은 원문으로 다시 시도해줘.',
        createdAt: '2026-06-08T14:00:00.000Z',
      },
    ],
    {
      runId: 'run-401',
      sourceMessageId: 'msg-401',
      status: 'failed',
      stage: 'failed',
      model: 'gpt-4.1',
      mode: 'balanced',
      errorCode: 'cloud_inference_network',
      failure: {
        failedStage: 'cloud_pending',
        message: '네트워크 오류',
        guidance: '잠시 후 다시 시도하거나 다른 모델로 이어갈 수 있습니다.',
        retryable: true,
      },
    },
  );

  assert.equal(sourceMessage?.contentKo, '같은 원문으로 다시 시도해줘.');
  assert.match(chatRouteSource, /run-status-card/);
  assert.match(chatRouteSource, /desktopClient\.commands\.retryRun/);
  assert.match(chatRouteSource, /navigate\('\/settings'\)/);
  assert.match(chatRouteSource, /modelRetryPrefillMessage/);
  assert.match(chatStylesSource, /\.run-status-card\s*\{/);
});

test('story-4.2:VAL-1, story-4.2:AC-1, and story-4.2:AC-2 build compact completed-response metadata with exact vs estimated savings wording', () => {
  const exactMetadata = getChatResponseMetadata({
    runId: 'run-501',
    sourceMessageId: 'msg-501',
    status: 'completed',
    stage: 'completed',
    model: 'claude-sonnet-4',
    mode: 'quality',
    errorCode: null,
    failure: null,
    usage: {
      baselineInputTokens: 120,
      optimizedInputTokens: 74,
      outputTokens: 98,
      latencyMs: 840,
      savingsRate: 38,
      isEstimated: false,
    },
  });
  const estimatedMetadata = getChatResponseMetadata({
    runId: 'run-502',
    sourceMessageId: 'msg-502',
    status: 'completed',
    stage: 'completed',
    model: 'gpt-4.1',
    mode: 'balanced',
    errorCode: null,
    failure: null,
    usage: {
      baselineInputTokens: 164,
      optimizedInputTokens: 100,
      outputTokens: 60,
      latencyMs: 1_420,
      savingsRate: 39,
      isEstimated: true,
    },
  });

  assert.deepEqual(exactMetadata?.items.map((item) => item.label), [
    'Claude Sonnet',
    '지연 840ms',
    '38% 절감',
  ]);
  assert.equal(exactMetadata?.items[2]?.tone, 'savings');
  assert.deepEqual(estimatedMetadata?.items.map((item) => item.label), [
    'GPT-4.1',
    '지연 1.4초',
    '예상 절감 39%',
  ]);
  assert.equal(estimatedMetadata?.actionLabel, '작업대에서 계속하기');
});

test('story-4.2:AC-4 and story-4.2:VAL-1 keep stage or error feedback for non-completed runs instead of completed metadata', () => {
  const failedRun = {
    runId: 'run-503',
    sourceMessageId: 'msg-503',
    status: 'failed' as const,
    stage: 'failed' as const,
    model: 'gemini-1.5-pro',
    mode: 'quality' as const,
    errorCode: 'cloud_inference_provider_unavailable',
    failure: {
      failedStage: 'cloud_pending' as const,
      message: '제공자 응답 없음',
      guidance: '잠시 후 다시 시도하세요.',
      retryable: true,
    },
  };

  assert.equal(getChatResponseMetadata(failedRun), null);
  assert.equal(getChatRunFeedback(failedRun)?.badgeLabel, '실행 중단');
  assert.match(chatRouteSource, /activeRun\?\.status === 'completed' \? null : getChatRunFeedback\(activeRun\)/);
});

test('story-4.2:VAL-2 and story-4.2:AC-3 continueTaskInWorkbench opens the existing task in workbench without creating a new task id', async () => {
  const openRequests: Array<{ taskId: string; panelSlot?: string }> = [];
  const navigations: string[] = [];

  const didNavigate = await continueTaskInWorkbench({
    desktopAvailable: true,
    navigate(path) {
      navigations.push(path);
    },
    openInWorkbench: async (request) => {
      openRequests.push(request);
      return {
        layoutId: 'layout-primary',
        taskId: request.taskId,
        panelSlot: 'north-west',
      };
    },
    taskId: 'task-continue-001',
  });

  assert.equal(didNavigate, true);
  assert.deepEqual(openRequests, [{ taskId: 'task-continue-001' }]);
  assert.deepEqual(navigations, ['/workbench']);
  assert.match(chatRouteSource, /responseMetadata\.actionLabel/);
  assert.match(chatRouteSource, /desktopClient\.commands\.openInWorkbench/);
  assert.match(chatStylesSource, /\.response-meta-action\s*\{/);
});

test('story-4.2:AC-5 and story-4.2:AC-6 source keeps response metadata compact and uses a restrained mint accent for savings only', () => {
  assert.match(chatRouteSource, /className=\"response-meta-row\"/);
  assert.match(chatRouteSource, /response-meta-item-savings/);
  assert.match(chatStylesSource, /\.response-meta-row\s*\{/);
  assert.match(chatStylesSource, /font-size:\s*0\.8rem/);
  assert.match(chatStylesSource, /\.response-meta-item-savings\s*\{/);
  assert.match(chatStylesSource, /background:\s*rgba\(55,\s*201,\s*171,\s*0\.12\)/);
});
