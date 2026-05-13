import { fetchComments } from '@/lib/api';
import type { IssueCommentDto } from '@/lib/types';
import {
  type ConfluencePageRef,
  extractConfluenceLinks,
  labelForConfluenceRef,
} from '@goose-hub/core/connectors/confluence.js';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

interface ConfluenceLinksSectionProps {
  body: string | undefined;
  projectSlug: string;
  externalId: string;
}

interface ConfluenceTitleResponse {
  title: string | null;
  available?: boolean;
}

async function fetchConfluenceTitle(pageId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/confluence/title?pageId=${encodeURIComponent(pageId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ConfluenceTitleResponse;
    return data.title ?? null;
  } catch {
    return null;
  }
}

export function ConfluenceLinksSection({
  body,
  projectSlug,
  externalId,
}: ConfluenceLinksSectionProps) {
  const { data: comments = [] } = useQuery<IssueCommentDto[]>({
    queryKey: ['comments', projectSlug, externalId],
    queryFn: () => fetchComments(projectSlug, externalId),
    staleTime: 30_000,
  });

  const refs: ConfluencePageRef[] = useMemo(() => {
    const combined = [body ?? '', ...comments.map((c) => c.body)].join('\n');
    return extractConfluenceLinks(combined);
  }, [body, comments]);

  const { data: titles = {} } = useQuery<Record<string, string | null>>({
    queryKey: [
      'confluence-titles',
      refs
        .map((r) => r.pageId)
        .sort()
        .join(','),
    ],
    queryFn: async () => {
      const entries = await Promise.all(
        refs.map(async (ref) => [ref.pageId, await fetchConfluenceTitle(ref.pageId)] as const),
      );
      return Object.fromEntries(entries);
    },
    enabled: refs.length > 0,
    staleTime: 5 * 60_000,
  });

  if (refs.length === 0) return null;

  return (
    <div
      data-testid="confluence-links-section"
      className="rounded-lg border border-line bg-bg-elev overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-line bg-bg-elev-2">
        <div className="text-[10.5px] uppercase tracking-wider text-fg-2">
          Confluence references
        </div>
      </div>
      <ul className="px-4 py-3 space-y-2 text-[13px]">
        {refs.map((ref) => {
          const title = titles[ref.pageId] ?? null;
          const label = labelForConfluenceRef(ref, title);
          return (
            <li key={ref.url}>
              <a
                href={ref.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
                data-testid="confluence-link"
                data-page-id={ref.pageId}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
