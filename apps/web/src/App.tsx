import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AllProjectsBoard } from './components/board/components/AllProjectsBoard';
import { Board } from './components/board/components/Board';
import { AppShell } from './components/chrome/AppShell';
import { CostsPage } from './components/costs/CostsPage';
import { DetailPage } from './components/detail/components/DetailPage';
import { InboxList } from './components/inbox/components/InboxList';
import { RosterPage } from './components/roster/components/RosterPage';
import { SettingsPage } from './components/settings/components/SettingsPage';
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
          <span className="mx-2 text-fg-2">/</span>
          <span>Kanban</span>
        </>
      }
    >
      <Board projectSlug={slug} />
    </AppShell>
  );
}

function GlobalShell({ children }: { children: React.ReactNode }) {
  return <ActiveProjectProvider>{children}</ActiveProjectProvider>;
}

function AllProjectsPage() {
  return (
    <GlobalShell>
      <AppShell breadcrumb={<span>All Projects</span>}>
        <LaneVisibilityProvider>
          <AllProjectsBoard />
        </LaneVisibilityProvider>
      </AppShell>
    </GlobalShell>
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

function InboxPage() {
  return (
    <AppShell breadcrumb={<span>Inbox</span>}>
      <InboxList />
    </AppShell>
  );
}

function RosterPageRoute() {
  return (
    <AppShell breadcrumb={<span>Roster</span>}>
      <RosterPage />
    </AppShell>
  );
}

function CostsPageRoute() {
  return (
    <AppShell breadcrumb={<span>Costs</span>}>
      <CostsPage />
    </AppShell>
  );
}

function SettingsPageRoute() {
  return (
    <GlobalShell>
      <AppShell breadcrumb={<span>Settings</span>}>
        <SettingsPage />
      </AppShell>
    </GlobalShell>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/projects/goose-hub-self" replace />} />
          <Route path="/settings" element={<SettingsPageRoute />} />
          <Route path="/projects/all" element={<AllProjectsPage />} />
          <Route
            path="/projects/:slug"
            element={
              <ProjectShell>
                <KanbanPage />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/inbox"
            element={
              <ProjectShell>
                <InboxPage />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/roster"
            element={
              <ProjectShell>
                <RosterPageRoute />
              </ProjectShell>
            }
          />
          <Route
            path="/projects/:slug/costs"
            element={
              <ProjectShell>
                <CostsPageRoute />
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
