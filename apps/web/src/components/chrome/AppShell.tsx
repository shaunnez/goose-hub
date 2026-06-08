import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: ReactNode;
  breadcrumb?: ReactNode;
  activeSlug?: string;
}

export function AppShell({ children, breadcrumb, activeSlug }: AppShellProps) {
  const params = useParams<{ slug?: string }>();
  return (
    <div className="flex h-screen w-screen text-fg bg-bg overflow-hidden">
      <Sidebar activeSlug={activeSlug ?? params.slug} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar breadcrumb={breadcrumb} />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
