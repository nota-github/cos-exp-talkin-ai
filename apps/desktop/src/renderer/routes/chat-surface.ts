import type {
  ChatFeedMessage,
  ChatFeedRunUsageSummary,
  ChatFeedRunSummary,
  CloudModelId,
  OpenInWorkbenchCommand,
  OpenInWorkbenchResult,
  OptimizationMode,
  SubmitPromptCommand,
  SubmitPromptResult,
} from '../../shared/ipc/contracts';

export type ChatSubmitState = {
  status: 'idle' | 'submitting' | 'success' | 'error';
  message: string | null;
};

export type PendingChatSubmission = ChatFeedMessage;

export type ChatSubmitOutcome = {
  activeStarterId: ChatStarterCard['id'] | null;
  pendingSubmission: PendingChatSubmission | null;
  promptDraft: string;
  submitState: ChatSubmitState;
};

export type ChatRunFeedbackActionId = 'retry' | 'open_settings' | 'select_other_model';

export type ChatRunFeedbackStep = {
  id: 'optimizing' | 'cloud_pending' | 'restoring';
  label: string;
  state: 'pending' | 'current' | 'completed';
};

export type ChatRunFeedback = {
  tone: 'progress' | 'success' | 'error';
  badgeLabel: string;
  title: string;
  description: string;
  detail: string | null;
  actions: ChatRunFeedbackActionId[];
  steps: ChatRunFeedbackStep[];
};

export type ChatResponseMetadataItem = {
  id: 'model' | 'latency' | 'savings';
  label: string;
  tone: 'neutral' | 'savings';
};

export type ChatResponseMetadata = {
  items: ChatResponseMetadataItem[];
  actionLabel: string;
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
  submitSavingMessage: '한국어 요청을 먼저 로컬 인박스에 안전하게 저장하고 있습니다.',
  submitSavedMessage: '한국어 요청이 로컬 인박스에 저장되었습니다. 대화 피드에서 바로 이어갈 수 있습니다.',
  submitFailureMessage:
    '로컬 저장에 실패했습니다. 입력한 내용은 그대로 남아 있으니 다시 시도해 주세요.',
  runRetryingMessage: '같은 한국어 원문으로 다시 실행을 요청하고 있습니다.',
  runRetryFailedMessage:
    '재시도 요청을 시작하지 못했습니다. 기존 한국어 원문은 그대로 남아 있으니 잠시 후 다시 시도해 주세요.',
  modelRetryPrefillMessage:
    '같은 한국어 원문을 다시 불러왔습니다. 모델을 바꾼 뒤 다시 보내세요.',
  conversationReadyTitle: '저장된 대화',
  queuedRunLabel: '로컬 저장 완료 · 실행 대기',
  savingRunLabel: '로컬 저장 중',
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

function getModelLabel(model: CloudModelId) {
  return modelOptions.find((option) => option.id === model)?.label ?? model;
}

export function createIdleChatSubmitState(): ChatSubmitState {
  return {
    status: 'idle',
    message: null,
  };
}

export function createSubmittingChatSubmitState(): ChatSubmitState {
  return {
    status: 'submitting',
    message: chatSurfaceCopy.submitSavingMessage,
  };
}

export function createSuccessfulChatSubmitState(): ChatSubmitState {
  return {
    status: 'success',
    message: chatSurfaceCopy.submitSavedMessage,
  };
}

export function createFailedChatSubmitState(): ChatSubmitState {
  return {
    status: 'error',
    message: chatSurfaceCopy.submitFailureMessage,
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

function formatLatencyLabel(latencyMs: number) {
  if (latencyMs < 1_000) {
    return `지연 ${latencyMs}ms`;
  }

  const seconds = latencyMs / 1_000;
  const displaySeconds = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
  return `지연 ${displaySeconds}초`;
}

function formatSavingsLabel(usage: ChatFeedRunUsageSummary) {
  return usage.isEstimated
    ? `예상 절감 ${usage.savingsRate}%`
    : `${usage.savingsRate}% 절감`;
}

export function mergeVisibleConversationMessages(
  persistedMessages: ChatFeedMessage[],
  pendingSubmission: PendingChatSubmission | null,
) {
  if (!pendingSubmission) {
    return persistedMessages;
  }

  if (persistedMessages.some((message) => message.messageId === pendingSubmission.messageId)) {
    return persistedMessages;
  }

  return [...persistedMessages, pendingSubmission];
}

export function getChatResponseMetadata(run: ChatFeedRunSummary | null): ChatResponseMetadata | null {
  if (run?.status !== 'completed' || !run.usage) {
    return null;
  }

  return {
    items: [
      {
        id: 'model',
        label: getModelLabel(run.model),
        tone: 'neutral',
      },
      {
        id: 'latency',
        label: formatLatencyLabel(run.usage.latencyMs),
        tone: 'neutral',
      },
      {
        id: 'savings',
        label: formatSavingsLabel(run.usage),
        tone: 'savings',
      },
    ],
    actionLabel: '작업대에서 계속하기',
  };
}

const runStepOrder: ChatRunFeedbackStep['id'][] = ['optimizing', 'cloud_pending', 'restoring'];

const runStepLabels: Record<ChatRunFeedbackStep['id'], string> = {
  optimizing: '로컬 최적화',
  cloud_pending: '모델 응답 대기',
  restoring: '한국어 복원',
};

function containsHangul(value: string | null) {
  return value !== null && /[가-힣]/.test(value);
}

function classifyRunFailure(errorCode: string | null) {
  if (!errorCode) {
    return 'unknown';
  }

  if (
    errorCode === 'local_optimization_missing_source_prompt' ||
    errorCode.startsWith('local_optimization_')
  ) {
    return 'local_engine';
  }

  if (
    errorCode === 'run_completion_missing_source_prompt' ||
    errorCode.startsWith('local_restore_')
  ) {
    return 'local_restore';
  }

  if (errorCode === 'cloud_inference_auth') {
    return 'provider_auth';
  }

  if (errorCode === 'cloud_inference_rate_limit') {
    return 'provider_rate_limit';
  }

  if (errorCode === 'cloud_inference_network') {
    return 'provider_network';
  }

  if (errorCode === 'cloud_inference_provider_unavailable') {
    return 'provider_unavailable';
  }

  if (errorCode === 'cloud_inference_invalid_request') {
    return 'invalid_request';
  }

  return 'unknown';
}

function getJourneyStage(run: ChatFeedRunSummary) {
  if (run.status === 'failed') {
    const failedStage = run.failure?.failedStage;

    if (failedStage === 'cloud_pending' || failedStage === 'restoring') {
      return failedStage;
    }

    return 'optimizing';
  }

  switch (run.stage) {
    case 'cloud_pending':
      return 'cloud_pending';
    case 'restoring':
    case 'completed':
      return 'restoring';
    case 'optimized':
      return 'cloud_pending';
    case 'queued':
    case 'optimizing':
    case 'failed':
    case null:
    default:
      return 'optimizing';
  }
}

function buildRunFeedbackSteps(run: ChatFeedRunSummary): ChatRunFeedbackStep[] {
  const currentStage = getJourneyStage(run);
  const currentIndex = runStepOrder.indexOf(currentStage);

  return runStepOrder.map((stepId, index) => {
    let state: ChatRunFeedbackStep['state'] = 'pending';

    if (run.status === 'completed') {
      state = 'completed';
    } else if (index < currentIndex) {
      state = 'completed';
    } else if (index === currentIndex) {
      state = 'current';
    }

    return {
      id: stepId,
      label: runStepLabels[stepId],
      state,
    };
  });
}

function getFailureStageLabel(run: ChatFeedRunSummary) {
  const failedStage = run.failure?.failedStage;

  if (failedStage === 'restoring') {
    return '한국어 복원';
  }

  if (failedStage === 'cloud_pending') {
    return '모델 응답';
  }

  return '로컬 최적화';
}

function buildFailureDescription(run: ChatFeedRunSummary) {
  const failureKind = classifyRunFailure(run.errorCode);

  switch (failureKind) {
    case 'local_engine':
    case 'local_restore':
      return '설정을 확인한 뒤 같은 한국어 원문으로 다시 시도할 수 있습니다.';
    case 'provider_auth':
      return 'API 키 연결 상태를 먼저 확인한 뒤 다시 실행하거나 다른 모델을 선택하세요.';
    case 'provider_rate_limit':
    case 'provider_network':
    case 'provider_unavailable':
      return '잠시 후 다시 시도하거나 다른 모델로 이어가는 편이 안전합니다.';
    case 'invalid_request':
      return '모델을 바꾸거나 요청 방향을 조정한 뒤 다시 보내는 편이 안전합니다.';
    case 'unknown':
    default:
      return '같은 한국어 원문은 그대로 남아 있으니 안전한 다음 행동을 고른 뒤 다시 이어가세요.';
  }
}

function buildFailureActions(run: ChatFeedRunSummary): ChatRunFeedbackActionId[] {
  const failureKind = classifyRunFailure(run.errorCode);
  const actions: ChatRunFeedbackActionId[] = [];
  const retryable = run.failure?.retryable !== false;

  if (
    retryable &&
    (failureKind === 'local_engine' ||
      failureKind === 'local_restore' ||
      failureKind === 'provider_rate_limit' ||
      failureKind === 'provider_network' ||
      failureKind === 'provider_unavailable' ||
      failureKind === 'unknown')
  ) {
    actions.push('retry');
  }

  if (
    failureKind === 'local_engine' ||
    failureKind === 'local_restore' ||
    failureKind === 'provider_auth' ||
    failureKind === 'unknown'
  ) {
    actions.push('open_settings');
  }

  if (
    failureKind === 'provider_auth' ||
    failureKind === 'provider_rate_limit' ||
    failureKind === 'provider_network' ||
    failureKind === 'provider_unavailable' ||
    failureKind === 'invalid_request'
  ) {
    actions.push('select_other_model');
  }

  return actions;
}

function buildFailureDetail(run: ChatFeedRunSummary) {
  if (containsHangul(run.failure?.guidance ?? null)) {
    return run.failure?.guidance ?? null;
  }

  if (containsHangul(run.failure?.message ?? null)) {
    return run.failure?.message ?? null;
  }

  return null;
}

export function resolveSourceMessageForRun(
  messages: ChatFeedMessage[],
  run: ChatFeedRunSummary | null,
) {
  if (!run) {
    return null;
  }

  return (
    messages.find((message) => message.messageId === run.sourceMessageId) ??
    [...messages].reverse().find((message) => message.role === 'user') ??
    null
  );
}

export function getChatRunFeedback(run: ChatFeedRunSummary | null): ChatRunFeedback | null {
  if (!run) {
    return null;
  }

  if (run.status === 'failed') {
    const stageLabel = getFailureStageLabel(run);

    return {
      tone: 'error',
      badgeLabel: '실행 중단',
      title: `${stageLabel} 단계에서 멈췄습니다`,
      description: buildFailureDescription(run),
      detail: buildFailureDetail(run),
      actions: buildFailureActions(run),
      steps: buildRunFeedbackSteps(run),
    };
  }

  if (run.status === 'completed') {
    return {
      tone: 'success',
      badgeLabel: '응답 준비 완료',
      title: '최종 답변이 대화 피드에 반영되었습니다',
      description: '같은 작업 흐름 안에서 다음 한국어 지시를 바로 이어갈 수 있습니다.',
      detail: null,
      actions: [],
      steps: buildRunFeedbackSteps(run),
    };
  }

  if (run.status === 'cloud_pending' || run.status === 'optimized') {
    return {
      tone: 'progress',
      badgeLabel: '모델 응답 대기',
      title: '선택한 클라우드 모델이 최적화된 영어 프롬프트를 처리하고 있습니다',
      description: '원문 한국어는 대화 기록에 그대로 남고, 내부적으로만 더 가벼운 영어 토큰 흐름을 사용합니다.',
      detail: null,
      actions: [],
      steps: buildRunFeedbackSteps(run),
    };
  }

  if (run.status === 'restoring') {
    return {
      tone: 'progress',
      badgeLabel: '한국어 복원',
      title: '영어 응답을 자연스러운 한국어로 복원하고 있습니다',
      description: '표, 숫자, 체크리스트 구조를 유지한 채 최종 답변을 정리하고 있습니다.',
      detail: null,
      actions: [],
      steps: buildRunFeedbackSteps(run),
    };
  }

  if (run.status === 'optimizing') {
    return {
      tone: 'progress',
      badgeLabel: '로컬 최적화',
      title: '한국어 요청을 더 효율적인 영어 토큰 흐름으로 정리하고 있습니다',
      description: '의도, 조건, 고유명사, 출력 형식을 보존한 채 로컬 엔진이 먼저 준비합니다.',
      detail: null,
      actions: [],
      steps: buildRunFeedbackSteps(run),
    };
  }

  return {
    tone: 'progress',
    badgeLabel: '실행 준비',
    title: '한국어 원문을 저장했고 로컬 최적화를 곧 시작합니다',
    description: '원문은 그대로 남아 있고, 같은 요청을 기반으로 실행 단계를 이어갑니다.',
    detail: null,
    actions: [],
    steps: buildRunFeedbackSteps(run),
  };
}

export function getRunFeedbackActionLabel(actionId: ChatRunFeedbackActionId) {
  switch (actionId) {
    case 'retry':
      return '재시도';
    case 'open_settings':
      return '설정 확인';
    case 'select_other_model':
      return '다른 모델 선택';
  }
}

export async function continueTaskInWorkbench(options: {
  desktopAvailable: boolean;
  navigate: (path: string) => void;
  openInWorkbench: (request: OpenInWorkbenchCommand) => Promise<OpenInWorkbenchResult>;
  taskId: string | null;
}) {
  if (!options.desktopAvailable || !options.taskId) {
    return false;
  }

  await options.openInWorkbench({
    taskId: options.taskId,
  });
  options.navigate('/workbench');
  return true;
}

export async function submitChatPromptDraft(options: {
  activeStarterId: ChatStarterCard['id'] | null;
  now?: () => string;
  optimizationMode: OptimizationMode;
  promptDraft: string;
  selectedModel: CloudModelId;
  submitPrompt: (request: SubmitPromptCommand) => Promise<SubmitPromptResult>;
}): Promise<ChatSubmitOutcome> {
  const promptKo = options.promptDraft;

  if (promptKo.trim().length === 0) {
    return {
      activeStarterId: options.activeStarterId,
      pendingSubmission: null,
      promptDraft: options.promptDraft,
      submitState: createIdleChatSubmitState(),
    };
  }

  try {
    const result = await options.submitPrompt({
      promptKo,
      selectedModel: options.selectedModel,
      optimizationMode: options.optimizationMode,
    });

    return {
      activeStarterId: null,
      pendingSubmission: {
        messageId: result.messageId,
        conversationId: result.conversationId,
        runId: result.runId,
        role: 'user',
        contentKo: promptKo,
        createdAt: options.now?.() ?? new Date().toISOString(),
      },
      promptDraft: '',
      submitState: createSuccessfulChatSubmitState(),
    };
  } catch {
    return {
      activeStarterId: options.activeStarterId,
      pendingSubmission: null,
      promptDraft: options.promptDraft,
      submitState: createFailedChatSubmitState(),
    };
  }
}
