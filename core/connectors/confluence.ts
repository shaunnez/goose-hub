/**
 * Confluence URL detection + optional page-title fetching (#324).
 *
 * Goose Hub does not ingest Confluence content end-to-end — that's
 * deferred. M14.05 only adds the surface needed to render Confluence
 * URLs in issue bodies and comments as labelled links ("Confluence:
 * <title>") rather than raw URLs.
 *
 * Detection is purely regex-based. The optional `fetchConfluencePageTitle`
 * helper hits the Confluence REST API when both `CONFLUENCE_HOST` and
 * `CONFLUENCE_API_TOKEN` are present, otherwise returns `null` so the UI
 * can fall back to the URL path.
 */

/**
 * Matches absolute Confluence Cloud URLs. Two canonical shapes are
 * supported:
 *
 *   https://example.atlassian.net/wiki/spaces/SPACE/pages/12345/Page+Title
 *   https://example.atlassian.net/wiki/spaces/SPACE/pages/12345
 *
 * Self-hosted servers using `/display/SPACE/Page+Title` are deferred.
 */
const CONFLUENCE_URL_PATTERN =
  /https:\/\/[a-z0-9.-]+\.atlassian\.net\/wiki\/spaces\/[A-Za-z0-9_-]+\/pages\/(\d+)(?:\/[^\s)\]]*)?/g;

export interface ConfluencePageRef {
  /** Full URL exactly as it appeared in the text. */
  url: string;
  /** Numeric page id parsed from the URL. */
  pageId: string;
  /** Human-friendly slug extracted from the URL trailing path, if any. */
  slug: string | null;
}

/**
 * Find all Confluence URLs in a markdown / plain-text body. Duplicate
 * URLs are deduplicated by their full string match (order preserved).
 */
export function extractConfluenceLinks(body: string): ConfluencePageRef[] {
  if (typeof body !== 'string' || body.length === 0) return [];
  const seen = new Set<string>();
  const refs: ConfluencePageRef[] = [];
  for (const match of body.matchAll(CONFLUENCE_URL_PATTERN)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const pageId = match[1];
    const slug = extractSlugFromUrl(url);
    refs.push({ url, pageId, slug });
  }
  return refs;
}

function extractSlugFromUrl(url: string): string | null {
  const match = url.match(/\/pages\/\d+\/(.+)$/);
  if (match == null) return null;
  return decodeURIComponent(match[1])
    .replace(/\+/g, ' ')
    .replace(/[?#].*$/, '')
    .trim();
}

export interface ConfluenceTitleFetcher {
  /** Returns the page title for `pageId`, or null if unavailable. */
  fetchTitle(pageId: string): Promise<string | null>;
}

export interface ConfluenceFetcherOptions {
  fetchImpl?: typeof fetch;
  host?: string;
  user?: string;
  apiToken?: string;
}

/**
 * Build a fetcher backed by the Confluence Cloud v1 REST API. Returns
 * `null` when credentials are not available — callers must check for
 * null and fall back to the URL path.
 */
export function makeConfluenceFetcher(
  options: ConfluenceFetcherOptions = {},
): ConfluenceTitleFetcher | null {
  const host = (options.host ?? process.env.CONFLUENCE_HOST ?? '').replace(/\/$/, '');
  const apiToken = options.apiToken ?? process.env.CONFLUENCE_API_TOKEN;
  const user = options.user ?? process.env.CONFLUENCE_USER ?? process.env.JIRA_USER;
  if (host.length === 0 || apiToken == null || apiToken.length === 0) return null;
  if (user == null || user.length === 0) return null;
  const fetchImpl = options.fetchImpl ?? fetch;

  const basic = Buffer.from(`${user}:${apiToken}`).toString('base64');

  return {
    async fetchTitle(pageId: string): Promise<string | null> {
      const res = await fetchImpl(`${host}/wiki/rest/api/content/${pageId}?expand=`, {
        headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { title?: string };
      return typeof body.title === 'string' ? body.title : null;
    },
  };
}

/**
 * Render the labelled link text for a Confluence reference. Uses the
 * fetched title when available, otherwise falls back to the slug, then
 * the page id. Always prefixed with "Confluence: " so the user sees the
 * source at a glance.
 */
export function labelForConfluenceRef(ref: ConfluencePageRef, title: string | null): string {
  const display = (title ?? ref.slug ?? ref.pageId).trim();
  return `Confluence: ${display}`;
}
