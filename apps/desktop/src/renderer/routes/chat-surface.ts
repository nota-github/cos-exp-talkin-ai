import type { CloudModelId, OptimizationMode } from '../../shared/ipc/contracts';

export type ChatSubmitState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message: string | null;
};

export type ChatStarterCard = {
  id: 'business-plan' | 'pdf-summary' | 'copy-polish';
  eyebrow: string;
  title: string;
  description: string;
  prompt: string;
};

export const chatSurfaceCopy = {
  headline: '무엇이든 한국어로 편하게 물어보세요',
  intro:
    '한국어로 시작하면 로컬 최적화 엔진이 영어 기반 토큰 흐름으로 정리하고, 클라우드 응답은 다시 자연스러운 한국어로 복원합니다.',
  savingsLabel: '이번 요청 예상 39% 절감',
  savingsDetail: '원문 한국어 1,240 tokens 대비 최적화 영어 756 tokens 흐름',
  starterTitle: '바로 시작할 작업',
  starterDescription: '추천 starter를 누르면 아래 composer 초안이 즉시 채워집니다.',
  recentInboxTitle: '최근 인박스',
  recentInboxDescription: '전송이 완료되면 이 레일에 최근 작업이 대화형 인박스로 쌓입니다.',
  recentInboxEmptyTitle: '아직 시작된 작업이 없습니다',
  recentInboxEmptyBody:
    '왼쪽 starter를 누르거나 아래 입력창에 첫 한국어 요청을 적어 보세요. 첫 전송 후에는 이 인박스가 최근 작업으로 바뀝니다.',
  guideTitle: '첫 요청 안내',
  guideBody:
    '추천 starter를 고르거나 아래 입력창에 원하는 작업을 직접 적으면, 첫 요청이 바로 채팅형 인박스 흐름으로 이어집니다.',
  draftPreviewEmpty:
    '추천 starter를 누르면 이 자리에서 작성 중인 한국어 요청을 바로 확인할 수 있습니다.',
  draftPreviewRole: '작성 중인 요청',
  recentPreviewRole: '최근 인박스 미리보기',
  placeholder:
    '긴 한국어 문장, 문서 요약 요청, 보고서 작성 요청도 그대로 입력하세요. 원문은 보존되고 내부에서만 더 가벼운 영어 토큰 흐름으로 정리됩니다.',
  metaTitle: '메타 프리뷰',
  metaBody: '사용 모델, 지연 시간, 절감률은 응답 아래 작은 메타 줄로 이어집니다.',
  previewModeBody: '브라우저 미리보기에서는 입력 shell만 확인할 수 있고 실제 전송은 데스크탑 셸에서 활성화됩니다.',
  primaryCta: '한국어 요청 시작하기',
} as const;

export const chatStarterCards: ChatStarterCard[] = [
  {
    id: 'business-plan',
    eyebrow: '사업계획서 초안',
    title: '시장 진입 전략이 보이는 초안',
    description: '목차, 수익 모델, 리스크, 다음 액션을 한 흐름으로 정리합니다.',
    prompt: '사업계획서 초안을 한국어로 구조화해줘',
  },
  {
    id: 'pdf-summary',
    eyebrow: '긴 PDF 요약',
    title: '긴 문서를 핵심만 남겨 요약',
    description: '긴 보고서나 리서치를 핵심 숫자와 리스크 중심으로 압축합니다.',
    prompt: '긴 PDF 핵심만 7개 항목으로 요약해줘',
  },
  {
    id: 'copy-polish',
    eyebrow: '카피 다듬기',
    title: '톤은 유지하고 문장은 더 또렷하게',
    description: '공지, 소개 문구, 캠페인 카피를 더 읽기 쉬운 한국어로 다듬습니다.',
    prompt: '브랜드 카피를 더 또렷한 문장으로 다듬어줘',
  },
];

export const modelOptions: Array<{ id: CloudModelId; label: string }> = [
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet' },
  { id: 'gemini-1.5-pro', label: 'Gemini' },
];

export const optimizationModeOptions: Array<{ id: OptimizationMode; label: string }> = [
  { id: 'balanced', label: '기본' },
  { id: 'savings', label: '절감 우선' },
  { id: 'quality', label: '품질 우선' },
  { id: 'long_context', label: '긴 컨텍스트' },
];

export function createIdleChatSubmitState(): ChatSubmitState {
  return {
    status: 'idle',
    message: null,
  };
}

export function createStarterDraftSelection(card: Pick<ChatStarterCard, 'id' | 'prompt'>) {
  return {
    activeStarterId: card.id,
    promptDraft: card.prompt,
    submitState: createIdleChatSubmitState(),
  };
}

export function getChatDraftPreview(promptDraft: string) {
  const trimmed = promptDraft.trim();
  return trimmed.length > 0 ? trimmed : chatSurfaceCopy.draftPreviewEmpty;
}
