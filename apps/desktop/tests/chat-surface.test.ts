import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  chatStarterCards,
  chatSurfaceCopy,
  createStarterDraftSelection,
  getChatDraftPreview,
  mergeVisibleConversationMessages,
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

test('story-2.2:AC-5 and story-2.2:AC-6 source switches the stage from landing guide to conversation feed with preserved multiline bubbles', () => {
  assert.match(chatRouteSource, /conversationMessages\.map/);
  assert.match(chatRouteSource, /pendingDraftPreview/);
  assert.match(chatRouteSource, /!showConversationFeed \?/);
  assert.match(chatStylesSource, /\.bubble-meta\s*\{/);
  assert.match(chatStylesSource, /white-space:\s*pre-wrap/);
});
