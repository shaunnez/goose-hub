/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectConfigPanel } from './ProjectConfigPanel';

const CONFIG = {
  slug: 'my-proj',
  name: 'My Project',
  source: { kind: 'github', repo: 'owner/my-proj' },
  targetRepo: {
    cloneUrl: 'git@github.com:owner/my-proj.git',
    defaultBranch: 'main',
    localPath: '~/code/my-proj',
  },
  stack: {
    runtime: 'node',
    packageManager: 'pnpm',
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
    e2eCommand: 'pnpm test:e2e',
  },
  activeMilestone: 'M10: Orchestration',
  colorStripe: '#7c3aed',
  budgets: { perWorkflowMaxUsd: 2, dailyTokens: 500000, perAdvisorMaxUsd: 0.5 },
  mode: 'supervised',
  storage: { path: '~/.factory/data/my-proj' },
  isolation: { mode: 'native' },
};

afterEach(() => cleanup());

describe('ProjectConfigPanel', () => {
  it('renders project summary fields without budget or milestone management sections', () => {
    render(<ProjectConfigPanel config={CONFIG} />);

    expect(screen.getByText('My Project')).toBeTruthy();
    expect(screen.getByText('github:owner/my-proj')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('~/code/my-proj')).toBeTruthy();
    expect(screen.getByText('pnpm test')).toBeTruthy();
    expect(screen.getByText('~/.factory/data/my-proj')).toBeTruthy();

    expect(screen.queryByText('Per-workflow $')).toBeNull();
    expect(screen.queryByText('Daily tokens')).toBeNull();
    expect(screen.queryByText('Per-advisor $')).toBeNull();
    expect(screen.queryByText('Milestones')).toBeNull();
  });
});
