import { NavLink, Outlet } from 'react-router-dom';
import { navigationItems } from './navigation';

export function AppShell() {
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <div className="brand-block">
          <span className="brand-kicker">한국어 우선 AI 작업 공간</span>
          <div className="brand-lockup">
            <div className="brand-mark">TA</div>
            <div>
              <h1>Talkin AI</h1>
              <p>한국어 AI를 더 오래, 더 깊게</p>
            </div>
          </div>
        </div>

        <nav
          aria-label="전체 탐색"
          className="nav-list"
        >
          {navigationItems.map((item) => (
            <NavLink
              key={item.id}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                isActive ? 'nav-item nav-item-active' : 'nav-item'
              }
            >
              <span className="nav-eyebrow">{item.eyebrow}</span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-summary">{item.summary}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-pill">작업 공간 준비됨</span>
          <p>채팅, 작업대, 프로젝트를 한 흐름으로 이어가는 데스크탑 작업 공간</p>
        </div>
      </aside>

      <main className="app-main">
        <header className="workspace-header">
          <div>
            <span className="workspace-kicker">작업 공간</span>
            <h2>업무형 AI 작업 공간</h2>
          </div>
          <div className="workspace-badges">
            <span className="badge badge-primary">로컬 최적화 준비됨</span>
            <span className="badge badge-success">절감 근거 추적 화면</span>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
