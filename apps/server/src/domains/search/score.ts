import type { WorkItem } from '@goose-hub/core/state-source/interface.js';

export interface ParsedQuery {
  raw: string;
  tokens: string[];
  externalId: string | null;
}

// Anything shorter than two characters is too noisy to score on; stopwords
// flood the title/body match path with false signal. List is intentionally
// short — agents prefer over-matching to under-matching at v0.
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const TITLE_WEIGHT = 30;
const MILESTONE_WEIGHT = 15;
const BODY_WEIGHT = 10;
const ID_DIRECT_HIT = 1000;
const RECENCY_WINDOW_DAYS = 30;
const RECENCY_MAX_BOOST = 0.1;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  const idMatch = trimmed.match(/^#?(\d{1,9})$/);
  const externalId = idMatch != null ? idMatch[1] : null;

  const tokens = Array.from(
    new Set(
      trimmed
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
    ),
  );

  return { raw: trimmed, tokens, externalId };
}

export function scoreItem(item: WorkItem, query: ParsedQuery, now: Date): number {
  if (query.externalId != null && item.externalId === query.externalId) {
    return ID_DIRECT_HIT;
  }

  if (query.tokens.length === 0) return 0;

  const title = item.title.toLowerCase();
  const body = (item.body ?? '').toLowerCase();
  const milestone = (item.milestoneTitle ?? '').toLowerCase();

  let raw = 0;
  for (const t of query.tokens) {
    if (title.includes(t)) raw += TITLE_WEIGHT;
    if (milestone.includes(t)) raw += MILESTONE_WEIGHT;
    if (body.includes(t)) raw += BODY_WEIGHT;
  }

  if (raw === 0) return 0;

  const ageDays = Math.max(0, (now.getTime() - item.createdAt.getTime()) / (24 * 60 * 60 * 1000));
  const recencyBoost =
    ageDays < RECENCY_WINDOW_DAYS ? (1 - ageDays / RECENCY_WINDOW_DAYS) * RECENCY_MAX_BOOST : 0;

  return raw * (1 + recencyBoost);
}

export function normalizeConfidence(score: number, topScore: number): number {
  if (topScore <= 0) return 0;
  return Math.round((score / topScore) * 100);
}

// Event search scores against a single text field (typically a decision
// summary). No title/body distinction, but the same recency boost shape.
const EVENT_TOKEN_WEIGHT = 30;

export function scoreEventText(
  text: string,
  query: ParsedQuery,
  createdAt: Date,
  now: Date,
): number {
  if (query.tokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let raw = 0;
  for (const t of query.tokens) {
    if (lower.includes(t)) raw += EVENT_TOKEN_WEIGHT;
  }
  if (raw === 0) return 0;
  const ageDays = Math.max(0, (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  const recencyBoost =
    ageDays < RECENCY_WINDOW_DAYS ? (1 - ageDays / RECENCY_WINDOW_DAYS) * RECENCY_MAX_BOOST : 0;
  return raw * (1 + recencyBoost);
}
