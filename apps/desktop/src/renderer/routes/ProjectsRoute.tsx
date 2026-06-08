const projects = [
  {
    name: '제품 리서치',
    detail: '긴 문서 요약과 경쟁사 분석을 묶어 관리',
  },
  {
    name: '사업계획서',
    detail: '목차, 수치 검토, 후속 피드백 작업을 연결',
  },
  {
    name: '문서 요약',
    detail: 'PDF별 핵심 요점과 체크리스트를 추적',
  },
];

export function ProjectsRoute() {
  return (
    <section className="screen">
      <header className="screen-header compact-header">
        <div>
          <span className="screen-kicker">Projects</span>
          <h1>장기 작업을 프로젝트 단위로 묶는 관리 화면</h1>
          <p>관련 작업, 파일, 문서, 대화 컨텍스트가 한 흐름으로 보이도록 설계된 placeholder입니다.</p>
        </div>
      </header>

      <div className="two-column-layout">
        <aside className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">프로젝트 목록</span>
              <h3>현재 연결된 작업</h3>
            </div>
            <button
              type="button"
              className="soft-button"
            >
              새 프로젝트
            </button>
          </div>

          <div className="preview-list">
            {projects.map((project) => (
              <button
                key={project.name}
                type="button"
                className="preview-row"
              >
                <strong>{project.name}</strong>
                <span>{project.detail}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel detail-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">프로젝트 상세</span>
              <h3>사업계획서</h3>
            </div>
            <span className="badge badge-primary">작업 12개 연결</span>
          </div>

          <div className="detail-grid">
            <article className="detail-card">
              <strong>새 작업 만들기</strong>
              <p>프로젝트 안에서 바로 장기 작업을 추가하는 CTA 자리입니다.</p>
            </article>
            <article className="detail-card">
              <strong>작업 검색</strong>
              <p>제목, 상태, 최근 활동 기준으로 필터링하는 검색 영역이 들어옵니다.</p>
            </article>
            <article className="detail-card">
              <strong>파일 목록</strong>
              <p>프로젝트에 연결된 PDF, 메모, 문서 자산이 여기에 표시됩니다.</p>
            </article>
            <article className="detail-card">
              <strong>프로젝트 설정</strong>
              <p>이름, 설명, 목표를 수정하는 설정 패널 placeholder입니다.</p>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}
