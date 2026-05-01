import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Board } from './components/board/Board';
import { AppShell } from './components/chrome/AppShell';
import { DetailPage } from './components/detail/components/DetailPage';
import { ActiveMilestoneProvider } from './state/active-milestone';
import { ActiveProjectProvider } from './state/active-project';
import { LaneVisibilityProvider } from './state/lane-visibility';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

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

function DetailPageRoute({ section }: { section?: string }) {
  return (
    <AppShell breadcrumb={<span className="text-fg-3">Detail</span>}>
      <DetailPage section={section} />
    </AppShell>
  );
}

function ProjectShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ slug?: string }>();
  const slug = params.slug ?? 'goose-hub-self';
  return (
    <ActiveProjectProvider initialSlug={slug}>
      <ActiveMilestoneProvider projectSlug={slug}>
        <LaneVisibilityProvider>{children}</LaneVisibilityProvider>
      </ActiveMilestoneProvider>
    </ActiveProjectProvider>
  );
}

function DetailPageRouteWithSection() {
  const { section } = useParams<{ section: string }>();
  return <DetailPageRoute section={section} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/projects/goose-hub-self" replace />} />
          <Route
            path="/projects/:slug"
            element={
              <ProjectShell>
                <KanbanPage />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/items/:id"
            element={
              <ProjectShell>
                <DetailPageRoute section="overview" />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/items/:id/:section"
            element={
              <ProjectShell>
                <DetailPageRouteWithSection />
              </ProjectShell>
            }
          />
        </Routes>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
