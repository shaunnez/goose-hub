export interface RepoEntry {
  slug: string;
  description: string;
}

export interface TierResult {
  repo: string;
  score: number;
  evidence: string;
}

/** Parse repos.md registry format into RepoEntry[]. */
export function parseReposRegistry(markdown: string): RepoEntry[] {
  const repos: RepoEntry[] = [];
  const lines = markdown.split('\n');
  let currentSlug: string | null = null;

  for (const line of lines) {
    // Match: ### [slug](url)
    const headingMatch = line.match(/^###\s+\[([^\]]+)\]/);
    if (headingMatch) {
      currentSlug = headingMatch[1].trim();
      continue;
    }
    // Match: **Description:** ...
    const descMatch = line.match(/^\*\*Description:\*\*\s+(.+)/);
    if (descMatch && currentSlug) {
      repos.push({ slug: currentSlug, description: descMatch[1].trim() });
      currentSlug = null;
    }
  }

  return repos;
}

/** Tokenise a string into lowercase words, splitting on non-alphanumeric chars. */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Score a repo candidate against a work item using keyword matching.
 *
 * Scoring weights (from issue spec):
 *   slug token match in title    = 10 pts
 *   slug token match in body     = 3 pts
 *   description token in title   = 2 pts
 *   description token in body    = 1 pt
 *   full slug match bonus        = 15 pts
 */
export function scoreRepo(
  repo: RepoEntry,
  workItemTitle: string,
  workItemBody: string,
): TierResult {
  const titleLower = workItemTitle.toLowerCase();
  const bodyLower = workItemBody.toLowerCase();

  // Full slug (owner/repo) and bare name tokens
  const slugName = repo.slug.split('/').pop() ?? repo.slug;
  const slugTokens = tokenise(slugName);
  const descTokens = tokenise(repo.description);

  let score = 0;
  const evidenceParts: string[] = [];

  // Full slug bonus
  if (titleLower.includes(slugName) || bodyLower.includes(slugName)) {
    score += 15;
    evidenceParts.push(`full slug match (${slugName})`);
  }

  // Slug token matches
  for (const token of slugTokens) {
    if (tokenise(titleLower).includes(token)) {
      score += 10;
      evidenceParts.push(`slug token "${token}" in title`);
    }
    if (tokenise(bodyLower).includes(token)) {
      score += 3;
      evidenceParts.push(`slug token "${token}" in body`);
    }
  }

  // Description token matches
  for (const token of descTokens) {
    if (tokenise(titleLower).includes(token)) {
      score += 2;
      evidenceParts.push(`desc token "${token}" in title`);
    }
    if (tokenise(bodyLower).includes(token)) {
      score += 1;
    }
  }

  return {
    repo: repo.slug,
    score,
    evidence:
      evidenceParts.length > 0 ? evidenceParts.slice(0, 3).join('; ') : 'no keyword matches',
  };
}

/**
 * Run tier-1 keyword matching against all repos.
 * Returns results sorted by score descending.
 */
export function runKeywordTier(
  repos: RepoEntry[],
  workItemTitle: string,
  workItemBody: string,
): TierResult[] {
  return repos
    .map((repo) => scoreRepo(repo, workItemTitle, workItemBody))
    .sort((a, b) => b.score - a.score);
}

/**
 * Convert a raw keyword score to a confidence percentage (0–100).
 * Scores are unbounded; we cap at 100.
 */
export function scoreToConfidence(score: number): number {
  // Heuristic: 30+ pts = 100%, scales linearly below
  return Math.min(100, Math.round((score / 30) * 100));
}
