import { NavLink, Outlet } from 'react-router-dom';
import { navigationItems } from './navigation';

export function AppShell() {
  return (
    <div className="app-frame">
      <aside className="app-sidebar">
        <div className="brand-block">
          <span className="brand-kicker">Korean-First Agent</span>
          <div className="brand-lockup">
            <div className="brand-mark">TA</div>
            <div>
              <h1>Talkin AI</h1>
              <p>한국어 AI를 더 오래, 더 깊게</p>
            </div>
          </div>
        </div>

        <nav
          aria-label="Global navigation"
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
          <span className="status-pill">Shell Ready</span>
          <p>context isolation이 적용된 데스크탑 라우트 셸</p>
        </div>
      </aside>

      <main className="app-main">
        <header className="workspace-header">
          <div>
            <span className="workspace-kicker">Workspace</span>
            <h2>업무형 AI 작업 공간</h2>
          </div>
          <div className="workspace-badges">
            <span className="badge badge-primary">로컬 최적화 대기</span>
            <span className="badge badge-success">화이트 + 블루 + 민트 시스템</span>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}
