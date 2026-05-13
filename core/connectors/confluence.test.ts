import { describe, expect, it, vi } from 'vitest';
import {
  extractConfluenceLinks,
  labelForConfluenceRef,
  makeConfluenceFetcher,
} from './confluence.js';

describe('extractConfluenceLinks', () => {
  it('returns an empty array for empty input', () => {
    expect(extractConfluenceLinks('')).toEqual([]);
  });

  it('detects a single Confluence URL with slug', () => {
    const body =
      'See https://example.atlassian.net/wiki/spaces/PROD/pages/12345/Onboarding+Guide for context.';
    expect(extractConfluenceLinks(body)).toEqual([
      {
        url: 'https://example.atlassian.net/wiki/spaces/PROD/pages/12345/Onboarding+Guide',
        pageId: '12345',
        slug: 'Onboarding Guide',
      },
    ]);
  });

  it('detects Confluence URLs without a slug', () => {
    const body = 'See https://example.atlassian.net/wiki/spaces/PROD/pages/77 for context.';
    expect(extractConfluenceLinks(body)).toEqual([
      {
        url: 'https://example.atlassian.net/wiki/spaces/PROD/pages/77',
        pageId: '77',
        slug: null,
      },
    ]);
  });

  it('detects multiple URLs and dedupes exact repeats', () => {
    const body = `
      first: https://example.atlassian.net/wiki/spaces/A/pages/1/One
      second: https://example.atlassian.net/wiki/spaces/B/pages/2/Two
      first again: https://example.atlassian.net/wiki/spaces/A/pages/1/One
    `;
    const refs = extractConfluenceLinks(body);
    expect(refs.map((r) => r.pageId)).toEqual(['1', '2']);
  });

  it('ignores non-Confluence URLs', () => {
    const body =
      'See https://github.com/shaunnez/goose-hub or https://example.com/wiki/pages/1/Page.';
    expect(extractConfluenceLinks(body)).toEqual([]);
  });

  it('tolerates URL-encoded slugs', () => {
    const body = 'https://example.atlassian.net/wiki/spaces/X/pages/9/A%20Page%20Name';
    const [ref] = extractConfluenceLinks(body);
    expect(ref.slug).toBe('A Page Name');
  });
});

describe('labelForConfluenceRef', () => {
  it('renders fetched title when available', () => {
    expect(
      labelForConfluenceRef(
        {
          url: 'https://example.atlassian.net/wiki/spaces/X/pages/9/Some+Page',
          pageId: '9',
          slug: 'Some Page',
        },
        'Real Title',
      ),
    ).toBe('Confluence: Real Title');
  });

  it('falls back to slug when title is null', () => {
    expect(
      labelForConfluenceRef(
        {
          url: 'https://example.atlassian.net/wiki/spaces/X/pages/9/Some+Page',
          pageId: '9',
          slug: 'Some Page',
        },
        null,
      ),
    ).toBe('Confluence: Some Page');
  });

  it('falls back to page id when title and slug are both unavailable', () => {
    expect(
      labelForConfluenceRef(
        {
          url: 'https://example.atlassian.net/wiki/spaces/X/pages/9',
          pageId: '9',
          slug: null,
        },
        null,
      ),
    ).toBe('Confluence: 9');
  });
});

describe('makeConfluenceFetcher', () => {
  it('returns null when CONFLUENCE_HOST is unset', () => {
    expect(makeConfluenceFetcher({ host: '', user: 'u', apiToken: 't' })).toBeNull();
  });

  it('returns null when CONFLUENCE_API_TOKEN is unset', () => {
    expect(
      makeConfluenceFetcher({
        host: 'https://example.atlassian.net',
        user: 'u',
        apiToken: '',
      }),
    ).toBeNull();
  });

  it('returns null when CONFLUENCE_USER / JIRA_USER are unset', () => {
    expect(
      makeConfluenceFetcher({
        host: 'https://example.atlassian.net',
        apiToken: 't',
        user: '',
      }),
    ).toBeNull();
  });

  it('fetches the page title via the REST API when credentials are present', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toBe('https://example.atlassian.net/wiki/rest/api/content/42?expand=');
      return new Response(JSON.stringify({ title: 'Hello' }), { status: 200 });
    });
    const fetcher = makeConfluenceFetcher({
      host: 'https://example.atlassian.net/',
      user: 'agent@example.com',
      apiToken: 'tok',
      fetchImpl,
    });
    expect(fetcher).not.toBeNull();
    expect(await fetcher?.fetchTitle('42')).toBe('Hello');
  });

  it('returns null on non-OK API response', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const fetcher = makeConfluenceFetcher({
      host: 'https://example.atlassian.net',
      user: 'u',
      apiToken: 't',
      fetchImpl,
    });
    expect(await fetcher?.fetchTitle('42')).toBeNull();
  });
});
