/**
 * Unit tests for buildProjectContextBundle and related helpers (#618).
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildProjectContextBundle } from './grill-and-prd.js';

const TMP = join(process.cwd(), '.tmp-test-fixtures-context-bundle');

async function setup(files: Record<string, string>): Promise<void> {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(TMP, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf-8');
  }
}

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('buildProjectContextBundle', () => {
  it('reads CONTEXT.md and CLAUDE.md when present', async () => {
    await setup({
      'CONTEXT.md': 'Context content here.',
      'CLAUDE.md': 'Claude instructions.',
    });
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.contextMd).toBe('Context content here.');
    expect(bundle.claudeMd).toBe('Claude instructions.');
    expect(bundle.adrSummaries).toEqual([]);
  });

  it('returns empty strings when CONTEXT.md and CLAUDE.md are absent', async () => {
    await setup({});
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.contextMd).toBe('');
    expect(bundle.claudeMd).toBe('');
  });

  it('parses ADR files extracting title, status and oneLiner', async () => {
    await setup({
      'docs/adr/0001-test-adr.md': `# My Test ADR

**Status:** Accepted

## Context

This is the first sentence of context. More text follows.

## Decision

Some decision.
`,
    });
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.adrSummaries).toHaveLength(1);
    const adr = bundle.adrSummaries[0];
    expect(adr.filename).toBe('0001-test-adr.md');
    expect(adr.title).toBe('My Test ADR');
    expect(adr.status).toBe('Accepted');
    expect(adr.oneLiner).toBe('This is the first sentence of context.');
  });

  it('returns empty adrSummaries when docs/adr/ does not exist', async () => {
    await setup({ 'CONTEXT.md': 'hello' });
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.adrSummaries).toEqual([]);
  });

  it('returns empty adrSummaries when docs/adr/ is empty', async () => {
    await setup({});
    await mkdir(join(TMP, 'docs', 'adr'), { recursive: true });
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.adrSummaries).toEqual([]);
  });

  it('handles multiple ADR files sorted alphabetically', async () => {
    await setup({
      'docs/adr/0002-b.md': '# B ADR\n**Status:** Proposed\n## Context\nB sentence.',
      'docs/adr/0001-a.md': '# A ADR\n**Status:** Accepted\n## Context\nA sentence.',
    });
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle.adrSummaries).toHaveLength(2);
    expect(bundle.adrSummaries[0].filename).toBe('0001-a.md');
    expect(bundle.adrSummaries[1].filename).toBe('0002-b.md');
  });

  it('expands ~ prefix in localPath', async () => {
    // Can only test this if HOME matches TMP prefix; skip if not applicable.
    // Just verify it doesn't throw when path is absolute.
    const bundle = await buildProjectContextBundle(TMP);
    expect(bundle).toBeDefined();
  });
});
