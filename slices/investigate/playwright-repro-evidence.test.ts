import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPlaywrightReproPlan, shouldSkipBeforeEvidence } from './playwright-repro-evidence.js';

const slug = 'unit-playwright';
const tmpReproDir = `/tmp/repro-${slug}`;
const tmpEvidenceWorktree = '/tmp/evidence-issue-42';

afterEach(() => {
  fs.rmSync(tmpReproDir, { recursive: true, force: true });
  fs.rmSync(tmpEvidenceWorktree, { recursive: true, force: true });
});

describe('playwright repro evidence workflow helper', () => {
  it('publishes deterministic evidence after collector output', () => {
    fs.mkdirSync(tmpReproDir, { recursive: true });
    const screenshot = path.join(tmpReproDir, 'step-1.png');
    const gif = path.join(tmpReproDir, 'walkthrough.gif');
    fs.writeFileSync(screenshot, 'png');
    fs.writeFileSync(gif, 'gif');

    const commands: string[] = [];
    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      commands.push([cmd, ...args].join(' '));
      if (cmd === 'git' && args.includes('rev-parse')) return Buffer.from('abc123\n');
      if (cmd === 'gh') {
        return Buffer.from('https://github.com/shaunnez/goose-hub/issues/42#issuecomment-1\n');
      }
      return Buffer.from('');
    });
    const spawnSync = vi.fn(() => ({ status: 1 }));
    const collect = vi.fn(() => ({
      issue: 42,
      slug,
      phase: 'before' as const,
      classification: 'reproduced' as const,
      reproduced: true,
      passed: false,
      status: 'failed',
      errors: ['REPRO_EXPECTED_BUG: missing error banner'],
      stdout: [],
      screenshots: [screenshot],
      videoPath: null,
      gifPath: gif,
      ffmpegError: null,
      notes: 'Bug reproduced',
    }));

    const output = runPlaywrightReproPlan({
      workspaceDir: '/repo',
      issueNumber: 42,
      repo: 'shaunnez/goose-hub',
      plan: {
        specPath: 'apps/web/e2e/repro-unit-playwright.spec.ts',
        slug,
        route: '/login',
        expectedAssertion: 'Error banner remains visible',
        reproSteps: ['Navigate to /login'],
        evidenceIntent: 'Capture the BEFORE login error.',
      },
      publisher: { execFileSync: execFileSync as never, spawnSync: spawnSync as never, collect },
    });

    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      expect.arrayContaining(['playwright', 'test', 'e2e/repro-unit-playwright.spec.ts']),
      expect.objectContaining({ cwd: '/repo' }),
    );
    expect(commands).toContain('git -C /tmp/evidence-issue-42 push origin evidence/issue-42');
    expect(commands.some((command) => command.startsWith('gh issue comment 42'))).toBe(true);
    expect(output.screenshots[0]?.githubUrl).toBe(
      'https://raw.githubusercontent.com/shaunnez/goose-hub/abc123/evidence/issue-42/step-1.png',
    );
    expect(output.commentUrl).toBe(
      'https://github.com/shaunnez/goose-hub/issues/42#issuecomment-1',
    );
  });

  it('skips only high-confidence static packets with known route and selectors', () => {
    expect(
      shouldSkipBeforeEvidence({
        route: '/settings',
        selectors: ['[data-testid="title"]'],
        expectedAssertion: 'Title copy',
        setupRequired: [],
        keyFiles: [{ path: 'apps/web/src/Settings.tsx', reason: 'renders title' }],
        confidence: 'high',
        skipBeforeEvidenceEligible: true,
      }),
    ).toBe(true);

    expect(
      shouldSkipBeforeEvidence({
        route: null,
        selectors: [],
        expectedAssertion: null,
        setupRequired: [],
        keyFiles: [],
        confidence: 'high',
        skipBeforeEvidenceEligible: true,
      }),
    ).toBe(false);
  });
});
