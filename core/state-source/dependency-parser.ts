export interface DependencyRef {
  type: 'depends-on' | 'blocks';
  repoRef: string | null;
  issueNumber: number;
}

const DEPENDS_ON_PREFIX = /^(?:depends[\s-]+on|deps)\s*:?\s/i;
const BLOCKS_PREFIX = /^blocks\s*:?\s/i;
const BLOCKED_BY_PREFIX = /^blocked[\s-]+by\s*:?\s/i;
const REF_PATTERN = /(?:([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+))?#(\d+)/g;

export function parseDependencies(body: string): DependencyRef[] {
  const results: DependencyRef[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let type: 'depends-on' | 'blocks' | null = null;

    if (DEPENDS_ON_PREFIX.test(trimmed) || BLOCKED_BY_PREFIX.test(trimmed)) {
      type = 'depends-on';
    } else if (BLOCKS_PREFIX.test(trimmed)) {
      type = 'blocks';
    }

    if (type === null) continue;

    for (const m of trimmed.matchAll(REF_PATTERN)) {
      const repoRef = m[1] ?? null;
      const issueNumber = Number.parseInt(m[2], 10);
      if (!Number.isNaN(issueNumber)) {
        results.push({ type, repoRef, issueNumber });
      }
    }
  }

  return results;
}
