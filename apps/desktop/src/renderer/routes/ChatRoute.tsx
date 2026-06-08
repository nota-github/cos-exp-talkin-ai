import { useRef, useState, type RefObject } from 'react';
import type { CloudModelId, OptimizationMode } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';
import {
  chatStarterCards,
  chatSurfaceCopy,
  createIdleChatSubmitState,
  createStarterDraftSelection,
  getChatDraftPreview,
  modelOptions,
  optimizationModeOptions,
  type ChatStarterCard,
  type ChatSubmitState,
} from './chat-surface';

type ChatInboxPreview = {
  taskId: string;
  title: string;
  preview: string;
  model: string;
  mode: string;
  savingsRate: number;
};

type ChatInboxViewProps = {
  activeStarterId: ChatStarterCard['id'] | null;
  canSubmit: boolean;
  inboxPreviews: ChatInboxPreview[];
  optimizationMode: OptimizationMode;
  promptDraft: string;
  selectedModel: CloudModelId;
  shellInfo: ReturnType<typeof getRendererDesktopClient>['shell'];
  showLoadingState: boolean;
  submitState: ChatSubmitState;
  desktopAvailable: boolean;
  queryError: Error | null;
  textareaRef: RefObject<HTMLTextAreaElement>;
  onDraftChange: (value: string) => void;
  onOptimizationModeSelect: (mode: OptimizationMode) => void;
  onStarterSelect: (card: ChatStarterCard) => void;
  onModelSelect: (model: CloudModelId) => void;
  onSubmit: () => void;
};

export function ChatInboxView({
  activeStarterId,
  canSubmit,
  inboxPreviews,
  optimizationMode,
  promptDraft,
  selectedModel,
  shellInfo,
  showLoadingState,
  submitState,
  desktopAvailable,
  queryError,
  textareaRef,
  onDraftChange,
  onOptimizationModeSelect,
  onStarterSelect,
  onModelSelect,
  onSubmit,
}: ChatInboxViewProps) {
  const hasInboxItems = inboxPreviews.length > 0;
  const latestPreview = inboxPreviews[0] ?? null;

  return (
    <section className="screen screen-chat">
      <div className="chat-inbox-shell">
        <aside className="panel starter-rail">
          <div className="panel-header panel-header-stack">
            <div>
              <span className="panel-kicker">Inbox Starters</span>
              <h3>{chatSurfaceCopy.starterTitle}</h3>
              <p>{chatSurfaceCopy.starterDescription}</p>
            </div>
            <span className="badge badge-success">3개 starter</span>
          </div>

          <div className="starter-list">
            {chatStarterCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="starter-card"
                aria-pressed={activeStarterId === card.id}
                onClick={() => onStarterSelect(card)}
              >
                <span className="starter-eyebrow">{card.eyebrow}</span>
                <strong>{card.title}</strong>
                <p>{card.description}</p>
                <span className="starter-prompt">{card.prompt}</span>
              </button>
            ))}
          </div>

          <section className="rail-section">
            <div className="rail-section-header">
              <div>
                <span className="section-title">{chatSurfaceCopy.recentInboxTitle}</span>
                <p>{chatSurfaceCopy.recentInboxDescription}</p>
              </div>
              <span className="badge badge-muted">
                {showLoadingState ? '불러오는 중' : hasInboxItems ? `${inboxPreviews.length}개` : '비어 있음'}
              </span>
            </div>

            {hasInboxItems ? (
              <div className="preview-list">
                {inboxPreviews.map((preview) => (
                  <article
                    key={preview.taskId}
                    className="preview-row preview-row-static"
                  >
                    <strong>{preview.title}</strong>
                    <span>{preview.preview}</span>
                    <span>
                      {preview.model} · {preview.mode} · 예상 {preview.savingsRate}% 절감
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <article className="empty-state-card">
                <span className="panel-kicker">Empty Inbox</span>
                <strong>{chatSurfaceCopy.recentInboxEmptyTitle}</strong>
                <p>{chatSurfaceCopy.recentInboxEmptyBody}</p>
              </article>
            )}
          </section>

          <div className="panel-footnote">
            <span className="badge badge-success">Desktop Shell</span>
            <p>
              {shellInfo
                ? `${shellInfo.platform}에서 preload 브리지 연결 완료`
                : '브라우저 미리보기에서는 preload 상태가 비어 있습니다.'}
            </p>
          </div>
        </aside>

        <section className="panel conversation-stage">
          <header className="inbox-stage-header">
            <div>
              <span className="screen-kicker">Chat Inbox</span>
              <h1>{chatSurfaceCopy.headline}</h1>
              <p>{chatSurfaceCopy.intro}</p>
            </div>
            <div className="inbox-stage-pills">
              <span className="savings-pill">{chatSurfaceCopy.savingsLabel}</span>
              <span className="badge badge-muted">{chatSurfaceCopy.savingsDetail}</span>
            </div>
          </header>

          <div className="message-lane">
            <article className="bubble bubble-system bubble-full">
              <span className="bubble-role">Talkin AI 안내</span>
              <p>
                {queryError
                  ? `인박스 미리보기를 불러오지 못했습니다. ${queryError.message}`
                  : chatSurfaceCopy.guideBody}
              </p>
            </article>

            <article className="inbox-guide-card">
              <span className="panel-kicker">{chatSurfaceCopy.guideTitle}</span>
              <strong>{chatSurfaceCopy.primaryCta}</strong>
              <p>{chatSurfaceCopy.recentInboxEmptyBody}</p>
            </article>

            <article className="bubble bubble-user">
              <span className="bubble-role">{chatSurfaceCopy.draftPreviewRole}</span>
              <p>{getChatDraftPreview(promptDraft)}</p>
            </article>

            {latestPreview ? (
              <article className="bubble bubble-history">
                <span className="bubble-role">{chatSurfaceCopy.recentPreviewRole}</span>
                <p>{latestPreview.preview}</p>
              </article>
            ) : null}
          </div>

          <div className="composer composer-dock">
            <div className="composer-toolbar">
              <div className="toolbar-group">
                <span className="toolbar-label">모델</span>
                {modelOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selectedModel === option.id}
                    onClick={() => onModelSelect(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="toolbar-group">
                <span className="toolbar-label">최적화 모드</span>
                {optimizationModeOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={optimizationMode === option.id}
                    onClick={() => onOptimizationModeSelect(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              aria-label="Korean prompt draft"
              className="composer-input"
              value={promptDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={chatSurfaceCopy.placeholder}
            />

            <div className="composer-footer">
              <div className="composer-meta">
                <strong>{chatSurfaceCopy.metaTitle}</strong>
                <p>{desktopAvailable ? chatSurfaceCopy.metaBody : chatSurfaceCopy.previewModeBody}</p>
                <div className="meta-inline">
                  <span>기본 모델: {selectedModel}</span>
                  <span>
                    모드:{' '}
                    {optimizationModeOptions.find((option) => option.id === optimizationMode)?.label ?? '기본'}
                  </span>
                </div>
                {submitState.message ? <p className="composer-status">{submitState.message}</p> : null}
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={onSubmit}
                disabled={!canSubmit}
              >
                {submitState.status === 'submitting' ? '요청 준비 중…' : chatSurfaceCopy.primaryCta}
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export function ChatRoute() {
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const chatFeedQuery = useDesktopQuery(
    queryCache,
    createDesktopQueryDescriptor('getChatFeed', {}),
    { enabled: desktopClient.available },
  );
  const shellInfo = desktopClient.shell;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [selectedModel, setSelectedModel] = useState<CloudModelId>('gpt-4.1');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>('balanced');
  const [activeStarterId, setActiveStarterId] = useState<ChatStarterCard['id'] | null>(null);
  const [submitState, setSubmitState] = useState<ChatSubmitState>(createIdleChatSubmitState);

  const inboxPreviews = chatFeedQuery.data?.items ?? [];
  const canSubmit =
    desktopClient.available &&
    promptDraft.trim().length > 0 &&
    submitState.status !== 'submitting';
  const showLoadingState = desktopClient.available && chatFeedQuery.status === 'loading' && !chatFeedQuery.data;

  function resetSubmitState() {
    setSubmitState(createIdleChatSubmitState());
  }

  function handleStarterSelect(card: ChatStarterCard) {
    const selection = createStarterDraftSelection(card);
    setActiveStarterId(selection.activeStarterId);
    setPromptDraft(selection.promptDraft);
    setSubmitState(selection.submitState);
    textareaRef.current?.focus();
  }

  function handleDraftChange(value: string) {
    setPromptDraft(value);
    setActiveStarterId(null);

    if (submitState.status !== 'idle' || submitState.message) {
      resetSubmitState();
    }
  }

  async function handleSubmit() {
    const promptKo = promptDraft.trim();
    if (!promptKo || !desktopClient.available) {
      return;
    }

    setSubmitState({
      status: 'submitting',
      message: '한국어 요청을 인박스에 올리고 있습니다.',
    });

    try {
      await desktopClient.commands.submitPrompt({
        promptKo,
        selectedModel,
        optimizationMode,
      });

      setPromptDraft('');
      setActiveStarterId(null);
      setSubmitState({
        status: 'success',
        message: '첫 요청이 인박스에 추가되었습니다. 새 조회가 반영되면 최근 작업 레일에서 바로 이어갈 수 있습니다.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '한국어 요청을 저장하지 못했습니다.';
      setSubmitState({
        status: 'error',
        message,
      });
    }
  }

  return (
    <ChatInboxView
      activeStarterId={activeStarterId}
      canSubmit={canSubmit}
      inboxPreviews={inboxPreviews}
      optimizationMode={optimizationMode}
      promptDraft={promptDraft}
      selectedModel={selectedModel}
      shellInfo={shellInfo}
      showLoadingState={showLoadingState}
      submitState={submitState}
      desktopAvailable={desktopClient.available}
      queryError={chatFeedQuery.error}
      textareaRef={textareaRef}
      onDraftChange={handleDraftChange}
      onOptimizationModeSelect={setOptimizationMode}
      onStarterSelect={handleStarterSelect}
      onModelSelect={setSelectedModel}
      onSubmit={() => {
        void handleSubmit();
      }}
    />
  );
}
