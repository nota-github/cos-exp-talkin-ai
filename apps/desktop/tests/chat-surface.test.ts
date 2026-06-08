import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  chatStarterCards,
  chatSurfaceCopy,
  createStarterDraftSelection,
  getChatDraftPreview,
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
