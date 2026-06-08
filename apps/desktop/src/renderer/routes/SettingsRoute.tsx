const settingSections = [
  {
    title: '로컬 최적화 엔진',
    description: '기본, 절감 우선, 품질 우선, 긴 컨텍스트 모드를 관리하는 자리입니다.',
  },
  {
    title: '기본 클라우드 모델',
    description: 'OpenAI, Anthropic, Gemini 중 기본 추론 모델을 고르는 placeholder입니다.',
  },
  {
    title: 'API 키 연결 상태',
    description: '연결 상태, 수정, 점검 흐름이 들어올 보안 설정 구역입니다.',
  },
  {
    title: '테마 및 응답 언어',
    description: '라이트, 다크, 시스템 테마와 응답 언어 설정을 담습니다.',
  },
];

export function SettingsRoute() {
  return (
    <section className="screen">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">Settings</span>
          <h1>엔진, 모델, 보안 연결 상태를 다루는 제어 화면</h1>
          <p>세부 폼과 비즈니스 로직은 이후 스토리에서 연결하고, 지금은 정보 구조와 보안 경계를 위한 셸만 제공합니다.</p>
        </div>
      </header>

      <div className="detail-grid">
        {settingSections.map((section) => (
          <article
            key={section.title}
            className="detail-card detail-card-large"
          >
            <span className="panel-kicker">설정 섹션</span>
            <strong>{section.title}</strong>
            <p>{section.description}</p>
            <button
              type="button"
              className="soft-button"
            >
              설정 셸 확인
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
