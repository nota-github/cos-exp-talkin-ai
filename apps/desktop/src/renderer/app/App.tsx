import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { defaultRoutePath, navigationItems } from './navigation';
import { RendererSettingsProvider } from './renderer-settings';
import { ChatRoute } from '../routes/ChatRoute';
import { WorkbenchRoute } from '../routes/WorkbenchRoute';
import { ProjectsRoute } from '../routes/ProjectsRoute';
import { UsageRoute } from '../routes/UsageRoute';
import { SettingsRoute } from '../routes/SettingsRoute';

const routeElements = {
  chat: <ChatRoute />,
  workbench: <WorkbenchRoute />,
  projects: <ProjectsRoute />,
  usage: <UsageRoute />,
  settings: <SettingsRoute />,
};

export function App() {
  return (
    <HashRouter>
      <RendererSettingsProvider>
        <Routes>
          <Route element={<AppShell />}>
            {navigationItems.map((item) => (
              <Route
                key={item.id}
                path={item.path}
                element={routeElements[item.id]}
              />
            ))}
            <Route
              path="*"
              element={
                <Navigate
                  to={defaultRoutePath}
                  replace
                />
              }
            />
          </Route>
        </Routes>
      </RendererSettingsProvider>
    </HashRouter>
  );
}
