const historyRows = [
  {
    title: '신규 파트너 제안서 초안',
    baseline: '1,240',
    optimized: '756',
    savings: '39%',
  },
  {
    title: '긴 PDF 1차 요약',
    baseline: '2,080',
    optimized: '1,214',
    savings: '42%',
  },
  {
    title: '공지 카피 다듬기',
    baseline: '620',
    optimized: '451',
    savings: '27%',
  },
];

export function UsageRoute() {
  return (
    <section className="screen">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">Usage & History</span>
          <h1>로컬 최적화가 만든 토큰 절감 근거를 확인하는 화면</h1>
          <p>일반 사용자는 결과만 보고, 고급 사용자는 원문-최적화-복원 흐름을 펼쳐 볼 수 있도록 설계합니다.</p>
        </div>
      </header>

      <div className="metric-grid">
        <article className="panel metric-card">
          <span className="metric-label">이번 달 토큰 절감률</span>
          <strong>38%</strong>
          <p>로컬 최적화 없이 사용했을 때와 실제 적용 결과를 비교합니다.</p>
        </article>
        <article className="panel metric-card">
          <span className="metric-label">절감 금액</span>
          <strong>$42.70</strong>
          <p>선택 모델의 동일 가격 기준에서 계산한 추정 절감액입니다.</p>
        </article>
        <article className="panel metric-card">
          <span className="metric-label">감소 토큰</span>
          <strong>128,420</strong>
          <p>원문 한국어 대비 최적화된 영어 프롬프트 기준 누적 감소량입니다.</p>
        </article>
      </div>

      <div className="two-column-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">비교 뷰</span>
              <h3>Without vs With Local Optimization</h3>
            </div>
          </div>

          <div className="comparison-stack">
            <article className="comparison-card comparison-card-warning">
              <strong>로컬 최적화 없이 사용했다면</strong>
              <p>한국어 원문 그대로 클라우드 모델로 전달되어 더 긴 입력 토큰이 발생합니다.</p>
            </article>
            <article className="comparison-card comparison-card-success">
              <strong>로컬 최적화를 적용해서</strong>
              <p>의도와 구조를 유지한 영어 토큰 흐름으로 압축해 비용 효율을 개선합니다.</p>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">히스토리 상세</span>
              <h3>최근 요청 샘플</h3>
            </div>
          </div>

          <div className="history-table">
            {historyRows.map((row) => (
              <div
                key={row.title}
                className="history-row"
              >
                <strong>{row.title}</strong>
                <span>원문 {row.baseline} tokens</span>
                <span>최적화 {row.optimized} tokens</span>
                <span className="savings-pill">{row.savings} 절감</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
