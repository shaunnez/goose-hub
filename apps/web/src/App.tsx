import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/chrome/AppShell';
import { ActiveProjectProvider } from './state/active-project';

function KanbanPlaceholder() {
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  return (
    <AppShell
      breadcrumb={
        <>
          <span className="font-mono text-fg-3">{slug}</span>
          <span className="mx-2 text-fg-4">/</span>
          <span>Kanban</span>
        </>
      }
    >
      <div className="h-full flex items-center justify-center text-fg-3 text-sm">
        Kanban arrives in M2.06 (#31).
      </div>
    </AppShell>
  );
}

function ProjectRoutes() {
  const params = useParams<{ slug?: string }>();
  return (
    <ActiveProjectProvider initialSlug={params.slug}>
      <KanbanPlaceholder />
    </ActiveProjectProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/projects/goose-hub-self" replace />} />
        <Route path="/projects/:slug" element={<ProjectRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
