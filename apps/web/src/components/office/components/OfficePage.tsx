// AppShell-wrapped Office route entry. Mounted at /projects/:slug/office.

import { AppShell } from '@/components/chrome/AppShell';
import { useParams } from 'react-router-dom';
import { OfficeTab } from './OfficeTab';

export function OfficePage() {
  const { slug = 'goose-hub-self' } = useParams<{ slug: string }>();
  return (
    <AppShell
      breadcrumb={
        <>
          <span className="font-mono text-fg-3">{slug}</span>
          <span className="mx-2 text-fg-2">/</span>
          <span>Office</span>
        </>
      }
    >
      <OfficeTab initialProjectSlug={slug} />
    </AppShell>
  );
}
