const workbenchPanels = [
  '신규 제품 리서치',
  '사업계획서 개요',
  '긴 문서 요약',
  '운영 공지 개정',
];

const recentTasks = [
  'AI 검토가 필요한 파트너 제안서',
  '사람 검토 대기 중인 요약본',
  '진행 중인 카피 리라이트',
];

export function WorkbenchRoute() {
  return (
    <section className="screen">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">Workbench</span>
          <h1>여러 AI 작업을 동시에 관리하는 멀티채팅 작업대</h1>
          <p>좌측 최근 작업 레일과 2x2 패널 배치를 갖춘 데스크탑 중심 화면의 placeholder입니다.</p>
        </div>
      </header>

      <div className="workbench-layout">
        <aside className="panel workbench-rail">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">최근 작업</span>
              <h3>드래그할 작업 카드</h3>
            </div>
          </div>

          <div className="task-rail">
            {recentTasks.map((task) => (
              <button
                key={task}
                type="button"
                className="task-card"
              >
                <strong>{task}</strong>
                <span>작업대에 열기 · 상태 유지</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="workbench-grid">
          {workbenchPanels.map((title) => (
            <article
              key={title}
              className="panel workbench-panel"
            >
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">Panel</span>
                  <h3>{title}</h3>
                </div>
                <span className="badge badge-muted">독립 채팅 슬롯</span>
              </div>
              <p>여기에 독립적인 대화 기록, 상태, 활동 로그, 추가 지시 입력창이 들어올 예정입니다.</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
