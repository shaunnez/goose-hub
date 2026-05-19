import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEvidencePostPlan } from './evidence-post-workflow.js';

const issueNumber = 42;
const workspaceDir = '/tmp/evidence-post-workflow-test';
const stagingDir = `/tmp/evidence-staging-${issueNumber}`;
const helperWorktree = `/tmp/evidence-issue-${issueNumber}`;

afterEach(() => {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.rmSync(helperWorktree, { recursive: true, force: true });
  fs.rmSync('/tmp/evidence-staging-813', { recursive: true, force: true });
  fs.rmSync('/tmp/evidence-issue-813', { recursive: true, force: true });
  fs.rmSync('/tmp/evidence-post-outside.spec.ts', { force: true });
});

function plan() {
  return {
    specPath: 'apps/web/e2e/issue-42.spec.ts',
    slug: 'evidence-issue-42',
    validationIntent: 'Validate the shipped login fix.',
    expectedAssertions: ['Login succeeds'],
  };
}

describe('evidence-post workflow helper', () => {
  it('stages package-local issue evidence artifacts from the implementation worktree', () => {
    const issue813 = 813;
    const staging813 = `/tmp/evidence-staging-${issue813}`;
    const packageEvidenceDir = path.join(workspaceDir, 'apps/web/evidence/issue-813');
    const ignoredEvidenceDir = path.join(workspaceDir, 'node_modules/pkg/evidence/issue-813');
    fs.mkdirSync(packageEvidenceDir, { recursive: true });
    fs.mkdirSync(ignoredEvidenceDir, { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'apps/web/e2e'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'apps/web/e2e/issue-813.spec.ts'), 'spec');
    fs.writeFileSync(path.join(packageEvidenceDir, 'step-1.png'), 'png');
    fs.writeFileSync(path.join(packageEvidenceDir, 'step-2.jpeg'), 'jpeg');
    fs.writeFileSync(path.join(packageEvidenceDir, 'walkthrough.gif'), 'gif');
    fs.writeFileSync(path.join(ignoredEvidenceDir, 'junk.png'), 'png');

    const spawnSync = vi.fn(() => ({ status: 0 }));
    const collect = vi.fn(() => ({
      issue: issue813,
      slug: 'evidence-issue-813',
      phase: 'after' as const,
      classification: 'validation_failed' as const,
      reproduced: false,
      passed: false,
      status: 'failed',
      consoleErrors: [],
      testErrors: ['Expected button to be visible'],
      runnerErrors: [],
      errors: ['Expected button to be visible'],
      stdout: [],
      screenshots: [],
      videoPath: null,
      gifPath: null,
      ffmpegError: null,
      notes: 'Expected button to be visible',
    }));

    runEvidencePostPlan({
      plan: {
        specPath: 'apps/web/e2e/issue-813.spec.ts',
        slug: 'evidence-issue-813',
        validationIntent: 'Validate issue 813 after-state.',
        expectedAssertions: ['Issue 813 evidence captured'],
      },
      workspaceDir,
      issueNumber: issue813,
      repo: 'owner/repo',
      prNumber: 20,
      prHeadSha: 'def5678',
      publisher: { spawnSync: spawnSync as never, collect },
    });

    expect(fs.existsSync(path.join(staging813, 'step-1.png'))).toBe(true);
    expect(fs.existsSync(path.join(staging813, 'step-2.jpeg'))).toBe(true);
    expect(fs.existsSync(path.join(staging813, 'walkthrough.gif'))).toBe(true);
    expect(fs.existsSync(path.join(staging813, 'junk.png'))).toBe(false);
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: issue813,
        evidenceDir: staging813,
        resultsPath: path.join(staging813, 'pw-results.json'),
      }),
    );
  });

  it('publishes evidence only after collector classifies the AFTER run as passed', () => {
    const screenshotDir = path.join(workspaceDir, 'evidence', `issue-${issueNumber}`);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, 'apps/web/e2e'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'apps/web/e2e/issue-42.spec.ts'), 'spec');
    fs.writeFileSync(path.join(screenshotDir, 'step-1.png'), 'png');
    fs.mkdirSync(stagingDir, { recursive: true });
    const gif = path.join(stagingDir, 'walkthrough.gif');
    fs.writeFileSync(gif, 'gif');

    const commands: string[] = [];
    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      commands.push([cmd, ...args].join(' '));
      if (cmd === 'git' && args.includes('rev-parse')) return Buffer.from('abc1234\n');
      if (cmd === 'gh') {
        return Buffer.from('https://github.com/owner/repo/issues/42#issuecomment-1\n');
      }
      return Buffer.from('');
    });
    const spawnSync = vi.fn(() => ({ status: 0 }));
    const collect = vi.fn(() => ({
      issue: issueNumber,
      slug: 'evidence-issue-42',
      phase: 'after' as const,
      classification: 'passed' as const,
      reproduced: false,
      passed: true,
      status: 'passed',
      consoleErrors: [],
      testErrors: [],
      runnerErrors: [],
      errors: [],
      stdout: [],
      screenshots: [path.join(stagingDir, 'step-1.png')],
      videoPath: null,
      gifPath: gif,
      ffmpegError: null,
      notes: 'Playwright passed',
    }));

    const output = runEvidencePostPlan({
      plan: plan(),
      workspaceDir,
      issueNumber,
      repo: 'owner/repo',
      prNumber: 10,
      prHeadSha: 'def5678',
      publisher: { execFileSync: execFileSync as never, spawnSync: spawnSync as never, collect },
    });

    expect(spawnSync).toHaveBeenCalledWith(
      'pnpm',
      expect.arrayContaining(['playwright', 'test', 'e2e/issue-42.spec.ts']),
      expect.objectContaining({ cwd: workspaceDir }),
    );
    expect(commands).toContain('git -C /tmp/evidence-issue-42 push origin evidence/issue-42');
    expect(commands.some((command) => command.startsWith('gh issue comment 42'))).toBe(true);
    expect(output.commentUrl).toBe('https://github.com/owner/repo/issues/42#issuecomment-1');
    expect(output.screenshots[0]?.githubUrl).toBe(
      'https://raw.githubusercontent.com/owner/repo/abc1234/evidence/issue-42/step-1.png',
    );
  });

  it('does not publish validation failures', () => {
    const execFileSync = vi.fn(() => Buffer.from(''));
    const spawnSync = vi.fn(() => ({ status: 1 }));
    fs.mkdirSync(path.join(workspaceDir, 'apps/web/e2e'), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'apps/web/e2e/issue-42.spec.ts'), 'spec');
    const collect = vi.fn(() => ({
      issue: issueNumber,
      slug: 'evidence-issue-42',
      phase: 'after' as const,
      classification: 'validation_failed' as const,
      reproduced: false,
      passed: false,
      status: 'failed',
      consoleErrors: [],
      testErrors: ['Expected button to be visible'],
      runnerErrors: [],
      errors: ['Expected button to be visible'],
      stdout: [],
      screenshots: [],
      videoPath: null,
      gifPath: null,
      ffmpegError: null,
      notes: 'Expected button to be visible',
    }));

    const output = runEvidencePostPlan({
      plan: plan(),
      workspaceDir,
      issueNumber,
      repo: 'owner/repo',
      prNumber: 10,
      prHeadSha: 'def5678',
      publisher: { execFileSync: execFileSync as never, spawnSync: spawnSync as never, collect },
    });

    expect(execFileSync).not.toHaveBeenCalled();
    expect(output.commentUrl).toBeUndefined();
    expect(output.decisionSummaries[0]?.summary).toContain('validation_failed');
  });

  it('does not spawn Playwright when the planner declares no assertions', () => {
    const spawnSync = vi.fn(() => ({ status: 1 }));

    const output = runEvidencePostPlan({
      plan: { ...plan(), expectedAssertions: [] },
      workspaceDir,
      issueNumber,
      repo: 'owner/repo',
      prNumber: 10,
      prHeadSha: 'def5678',
      publisher: { spawnSync: spawnSync as never },
    });

    expect(spawnSync).not.toHaveBeenCalled();
    expect(output.commentUrl).toBeUndefined();
    expect(output.decisionSummaries[0]?.summary).toContain('no AFTER-state assertions');
  });

  it('rejects evidence specs outside apps/web/e2e before spawning Playwright', () => {
    const outsideSpecPath = '/tmp/evidence-post-outside.spec.ts';
    fs.writeFileSync(outsideSpecPath, 'spec');

    const spawnSync = vi.fn(() => ({ status: 0 }));

    const output = runEvidencePostPlan({
      plan: {
        ...plan(),
        specPath: outsideSpecPath,
      },
      workspaceDir,
      issueNumber,
      repo: 'owner/repo',
      prNumber: 10,
      prHeadSha: 'def5678',
      publisher: { spawnSync: spawnSync as never },
    });

    expect(spawnSync).not.toHaveBeenCalled();
    expect(output.commentUrl).toBeUndefined();
    expect(output.decisionSummaries[0]?.summary).toContain('Invalid evidence specPath');
  });
});
