import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Board } from './components/board/Board';
import { AppShell } from './components/chrome/AppShell';
import { ActiveMilestoneProvider } from './state/active-milestone';
import { ActiveProjectProvider } from './state/active-project';
import { LaneVisibilityProvider } from './state/lane-visibility';

function KanbanPage() {
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
      <Board projectSlug={slug} />
    </AppShell>
  );
}

function ProjectRoutes() {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? 'goose-hub-self';
  return (
    <ActiveProjectProvider initialSlug={slug}>
      <ActiveMilestoneProvider projectSlug={slug}>
        <LaneVisibilityProvider>
          <KanbanPage />
        </LaneVisibilityProvider>
      </ActiveMilestoneProvider>
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
