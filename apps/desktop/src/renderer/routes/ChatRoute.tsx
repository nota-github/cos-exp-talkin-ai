const suggestedPrompts = [
  '사업계획서 초안을 한국어로 구조화해줘',
  '긴 PDF 핵심만 7개 항목으로 요약해줘',
  '브랜드 카피를 더 또렷한 문장으로 다듬어줘',
];

const inboxPreviews = [
  {
    title: '신규 파트너 제안서 초안',
    note: 'Claude Sonnet · 품질 우선 · 예상 34% 절감',
  },
  {
    title: '40페이지 리서치 요약',
    note: 'GPT-4.1 · 긴 컨텍스트 · 예상 41% 절감',
  },
  {
    title: '운영 공지 카피 다듬기',
    note: 'Gemini 1.5 Pro · 기본 · 예상 27% 절감',
  },
];

export function ChatRoute() {
  const shellInfo = window.talkinAI?.shell;

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
            <span className="badge badge-muted">3개 프리뷰</span>
          </div>

          <div className="preview-list">
            {inboxPreviews.map((preview) => (
              <button
                key={preview.title}
                type="button"
                className="preview-row"
              >
                <strong>{preview.title}</strong>
                <span>{preview.note}</span>
              </button>
            ))}
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
              <span>기본 모델: GPT-4.1</span>
              <span>모드: 기본</span>
            </div>
          </div>

          <div className="message-lane">
            <article className="bubble bubble-system">
              <span className="bubble-role">Talkin AI</span>
              <p>사업계획서 초안, 긴 문서 요약, 카피 다듬기처럼 긴 작업을 한국어로 시작해 보세요.</p>
            </article>
            <article className="bubble bubble-user">
              <span className="bubble-role">예시 프롬프트</span>
              <p>시장 진입 전략이 보이도록 사업계획서 초안을 목차 중심으로 정리해줘.</p>
            </article>
          </div>

          <div className="composer">
            <div className="composer-toolbar">
              <div className="toolbar-group">
                <span className="toolbar-label">모델</span>
                <button type="button">GPT-4.1</button>
                <button type="button">Claude Sonnet</button>
                <button type="button">Gemini</button>
              </div>
              <div className="toolbar-group">
                <span className="toolbar-label">최적화 모드</span>
                <button type="button">기본</button>
                <button type="button">절감 우선</button>
                <button type="button">품질 우선</button>
                <button type="button">긴 컨텍스트</button>
              </div>
            </div>

            <textarea
              aria-label="Korean prompt draft"
              className="composer-input"
              placeholder="긴 한국어 문장도 그대로 입력하세요. 원문은 보존되고, 내부에서는 더 가벼운 영어 토큰 흐름으로 정리됩니다."
            />

            <div className="composer-footer">
              <div>
                <strong>메타 프리뷰</strong>
                <p>사용 모델, 지연 시간, 절감률은 응답 아래 작은 메타 줄로 표시될 예정입니다.</p>
              </div>
              <button
                type="button"
                className="primary-button"
                disabled
              >
                한국어로 작업 시작
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
