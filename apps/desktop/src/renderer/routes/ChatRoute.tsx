import { useState } from 'react';
import type { CloudModelId, OptimizationMode } from '../../shared/ipc/contracts';
import {
  createDesktopQueryDescriptor,
  getDesktopQueryCache,
  getRendererDesktopClient,
} from '../lib/ipc/query-client';
import { useDesktopQuery } from '../lib/ipc/query-hooks';

const fallbackSuggestedPrompts = [
  '사업계획서 초안을 한국어로 구조화해줘',
  '긴 PDF 핵심만 7개 항목으로 요약해줘',
  '브랜드 카피를 더 또렷한 문장으로 다듬어줘',
];

const modelOptions: Array<{ id: CloudModelId; label: string }> = [
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'claude-sonnet-4', label: 'Claude Sonnet' },
  { id: 'gemini-1.5-pro', label: 'Gemini' },
];

const optimizationModeOptions: Array<{ id: OptimizationMode; label: string }> = [
  { id: 'balanced', label: '기본' },
  { id: 'savings', label: '절감 우선' },
  { id: 'quality', label: '품질 우선' },
  { id: 'long_context', label: '긴 컨텍스트' },
];

export function ChatRoute() {
  const desktopClient = getRendererDesktopClient();
  const queryCache = getDesktopQueryCache();
  const chatFeedQuery = useDesktopQuery(
    queryCache,
    createDesktopQueryDescriptor('getChatFeed', {}),
    { enabled: desktopClient.available },
  );
  const shellInfo = desktopClient.shell;
  const [promptDraft, setPromptDraft] = useState('');
  const [selectedModel, setSelectedModel] = useState<CloudModelId>('gpt-4.1');
  const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>('balanced');
  const [submitState, setSubmitState] = useState<{
    status: 'idle' | 'submitting' | 'success' | 'error';
    message: string | null;
  }>({
    status: 'idle',
    message: null,
  });

  const suggestedPrompts = chatFeedQuery.data?.recommendedPrompts ?? fallbackSuggestedPrompts;
  const inboxPreviews = chatFeedQuery.data?.items ?? [];
  const canSubmit =
    desktopClient.available &&
    promptDraft.trim().length > 0 &&
    submitState.status !== 'submitting';
  const showLoadingState = desktopClient.available && chatFeedQuery.status === 'loading' && !chatFeedQuery.data;

  async function handleSubmit() {
    const promptKo = promptDraft.trim();
    if (!promptKo || !desktopClient.available) {
      return;
    }

    setSubmitState({
      status: 'submitting',
      message: '한국어 작업을 저장하고 있습니다.',
    });

    try {
      await desktopClient.commands.submitPrompt({
        promptKo,
        selectedModel,
        optimizationMode,
      });

      setPromptDraft('');
      setSubmitState({
        status: 'success',
        message: '작업이 인박스에 추가되었습니다. 변경 이벤트를 받아 새 조회로 목록을 갱신합니다.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '한국어 작업을 저장하지 못했습니다.';
      setSubmitState({
        status: 'error',
        message,
      });
    }
  }

  return (
    <section className="screen screen-chat">
      <header className="screen-header">
        <div>
          <span className="screen-kicker">Chat Inbox</span>
          <h1>무엇이든 한국어로 편하게 물어보세요</h1>
          <p>
            한국어로 시작하면 앱 내부의 로컬 최적화 엔진이 영어 기반 토큰 흐름으로 정리하고,
            응답은 다시 자연스러운 한국어로 복원합니다.
          </p>
        </div>

        <div className="hero-stat-card">
          <span className="hero-stat-label">이번 요청 예상 절감</span>
          <strong>39%</strong>
          <p>원문 한국어 기준 1,240 tokens → 최적화 영어 기준 756 tokens</p>
        </div>
      </header>

      <div className="chip-row">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="ghost-chip"
            onClick={() => {
              setPromptDraft(prompt);
              setSubmitState({
                status: 'idle',
                message: null,
              });
            }}
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="chat-layout">
        <aside className="panel inbox-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">진행 중인 인박스</span>
              <h3>바로 이어서 쓸 대화</h3>
            </div>
            <span className="badge badge-muted">
              {showLoadingState ? '동기화 중' : `${inboxPreviews.length}개 프리뷰`}
            </span>
          </div>

          <div className="preview-list">
            {inboxPreviews.length > 0 ? (
              inboxPreviews.map((preview) => (
                <button
                  key={preview.taskId}
                  type="button"
                  className="preview-row"
                >
                  <strong>{preview.title}</strong>
                  <span>
                    {preview.model} · {preview.mode} · 예상 {preview.savingsRate}% 절감
                  </span>
                </button>
              ))
            ) : (
              <article className="preview-row preview-row-static">
                <strong>첫 한국어 작업을 인박스에 추가하세요</strong>
                <span>전송이 완료되면 새 조회 기반으로 이 목록이 자동 갱신됩니다.</span>
              </article>
            )}
          </div>

          <div className="panel-footnote">
            <span className="badge badge-success">Desktop Shell</span>
            <p>
              {shellInfo
                ? `${shellInfo.platform}에서 preload 브리지 연결 완료`
                : '브라우저 미리보기에서는 preload 상태가 비어 있습니다.'}
            </p>
          </div>
        </aside>

        <section className="panel compose-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">새 한국어 작업</span>
                <h3>채팅형 인박스에서 바로 시작</h3>
              </div>
              <div className="meta-inline">
                <span>기본 모델: {selectedModel}</span>
                <span>
                  모드:{' '}
                  {optimizationModeOptions.find((option) => option.id === optimizationMode)?.label ?? '기본'}
                </span>
              </div>
            </div>

          <div className="message-lane">
            <article className="bubble bubble-system">
              <span className="bubble-role">Talkin AI</span>
              <p>
                {chatFeedQuery.error
                  ? `인박스 재조회 중 문제가 발생했습니다. ${chatFeedQuery.error.message}`
                  : '사업계획서 초안, 긴 문서 요약, 카피 다듬기처럼 긴 작업을 한국어로 시작해 보세요.'}
              </p>
            </article>
            <article className="bubble bubble-user">
              <span className="bubble-role">최근 인박스</span>
              <p>
                {inboxPreviews[0]?.preview ??
                  '시장 진입 전략이 보이도록 사업계획서 초안을 목차 중심으로 정리해줘.'}
              </p>
            </article>
          </div>

          <div className="composer">
            <div className="composer-toolbar">
              <div className="toolbar-group">
                <span className="toolbar-label">모델</span>
                {modelOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selectedModel === option.id}
                    onClick={() => setSelectedModel(option.id)}
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
                    onClick={() => setOptimizationMode(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              aria-label="Korean prompt draft"
              className="composer-input"
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              placeholder="긴 한국어 문장도 그대로 입력하세요. 원문은 보존되고, 내부에서는 더 가벼운 영어 토큰 흐름으로 정리됩니다."
            />

            <div className="composer-footer">
              <div>
                <strong>메타 프리뷰</strong>
                <p>사용 모델, 지연 시간, 절감률은 응답 아래 작은 메타 줄로 표시됩니다.</p>
                {submitState.message ? (
                  <p className="composer-status">{submitState.message}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!canSubmit}
              >
                {submitState.status === 'submitting' ? '저장 중…' : '한국어로 작업 시작'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
