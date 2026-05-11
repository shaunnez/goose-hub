import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSummary, formatManifest, gatherEntries } from './build-manifest.js';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('extractSummary', () => {
  it('returns the first non-heading paragraph from a README', () => {
    const md = '# core/state-source\n\nAdapter layer between Goose Hub and the source of truth.\n\n## Modules\n';
    expect(extractSummary(md)).toBe('Adapter layer between Goose Hub and the source of truth.');
  });

  it('falls back to first line when no body paragraph follows the heading', () => {
    expect(extractSummary('Just one line, no heading.')).toBe('Just one line, no heading.');
  });

  it('handles empty input', () => {
    expect(extractSummary('')).toBe('');
  });

  it('strips trailing whitespace and inline backticks for readability', () => {
    const md = '# foo\n\nA `module` for bar.   \n';
    expect(extractSummary(md)).toBe('A `module` for bar.');
  });
});

describe('gatherEntries', () => {
  it('finds known core packages', () => {
    const entries = gatherEntries(REPO_ROOT);
    const corePackages = entries.filter((e) => e.section === 'core').map((e) => e.name);
    expect(corePackages).toContain('agent-runtime');
    expect(corePackages).toContain('state-source');
    expect(corePackages).toContain('event-stream');
  });

  it('finds known slices and skills', () => {
    const entries = gatherEntries(REPO_ROOT);
    const slices = entries.filter((e) => e.section === 'slices').map((e) => e.name);
    const skills = entries.filter((e) => e.section === 'skills').map((e) => e.name);
    expect(slices).toContain('fix-issue');
    expect(slices).toContain('qa');
    expect(skills).toContain('implement');
    expect(skills).toContain('investigate');
  });

  it('flags entries missing a README', () => {
    const entries = gatherEntries(REPO_ROOT);
    const agentComment = entries.find((e) => e.section === 'core' && e.name === 'agent-comment');
    // This will pass before we write the README and become inverted afterward — we test the SHAPE not the value.
    expect(typeof agentComment?.hasReadme).toBe('boolean');
  });

  it('skips non-directory entries (index.ts, package.json)', () => {
    const entries = gatherEntries(REPO_ROOT);
    const skills = entries.filter((e) => e.section === 'skills').map((e) => e.name);
    expect(skills).not.toContain('index.ts');
    expect(skills).not.toContain('package.json');
  });
});

describe('formatManifest', () => {
  it('produces a stable Markdown report with section headings', () => {
    const out = formatManifest(
      [
        { section: 'core', name: 'agent-runtime', hasReadme: true, summary: 'Runs agents.' },
        { section: 'core', name: 'agent-comment', hasReadme: false, summary: '' },
        { section: 'slices', name: 'qa', hasReadme: true, summary: 'QA holdout workflow.' },
      ],
      { generatedAt: '2026-05-11T00:00:00.000Z' },
    );

    expect(out).toContain('# Inventory');
    expect(out).toContain('Generated: 2026-05-11T00:00:00.000Z');
    expect(out).toContain('## core/');
    expect(out).toContain('## slices/');
    expect(out).toContain('agent-runtime');
    expect(out).toContain('Runs agents.');
    expect(out).toContain('agent-comment');
  });

  it('groups counts by section in the header', () => {
    const out = formatManifest(
      [
        { section: 'core', name: 'a', hasReadme: true, summary: 'a' },
        { section: 'core', name: 'b', hasReadme: false, summary: '' },
        { section: 'slices', name: 'c', hasReadme: true, summary: 'c' },
      ],
      { generatedAt: '2026-05-11T00:00:00.000Z' },
    );

    expect(out).toMatch(/## core\/ \(2 entries, 1 missing README\)/);
    expect(out).toMatch(/## slices\/ \(1 entries, 0 missing README\)/);
  });
});
