import type { ProjectConfig } from '@goose-hub/core/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type WorkCommandIo,
  workCommand,
  workHelpLines,
  workInvestigateCommand,
  workStatusCommand,
} from './work.js';

function mkIo(env: Record<string, string> = {}): WorkCommandIo & {
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    write: (line: string) => out.push(line),
    writeErr: (line: string) => err.push(line),
    env,
    out,
    err,
  };
}

vi.mock('@goose-hub/core/projects/loader.js', async () => {
  const actual = await vi.importActual<typeof import('@goose-hub/core/projects/loader.js')>(
    '@goose-hub/core/projects/loader.js',
  );
  return {
    ...actual,
    loadProjects: vi.fn(),
  };
});

vi.mock('@goose-hub/core/state-source/jira.js', () => ({
  JiraStateSource: vi.fn().mockImplementation(() => ({
    listOpenWork: vi.fn().mockResolvedValue([
      {
        externalId: 'PAY-1',
        state: 'factory:accepted',
        title: 'Idempotency keys',
      },
      {
        externalId: 'PAY-2',
        state: 'factory:in-progress',
        title: 'Charge retry storm',
      },
    ]),
    getItem: vi.fn(async (key: string) => ({
      id: `jira:PAY#${key}`,
      externalId: key,
      title: 'A ticket',
    })),
  })),
}));

import { loadProjects } from '@goose-hub/core/projects/loader.js';

const mockedLoadProjects = vi.mocked(loadProjects);

beforeEach(() => {
  mockedLoadProjects.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('workCommand — WORK_MACHINE gate', () => {
  it('rejects every subcommand when WORK_MACHINE is unset', async () => {
    const io = mkIo({});
    const exit = await workCommand(['status'], io);
    expect(exit).toBe(1);
    expect(io.err.join('\n')).toContain('WORK_MACHINE is not set');
  });

  it('rejects `investigate` when WORK_MACHINE is unset', async () => {
    const io = mkIo({});
    const exit = await workInvestigateCommand(['my-slug', 'PAY-1'], io);
    expect(exit).toBe(1);
    expect(io.err.join('\n')).toContain('WORK_MACHINE is not set');
  });

  it('returns 1 with a usage line for unknown subcommands when gated open', async () => {
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workCommand(['nope'], io);
    expect(exit).toBe(1);
    expect(io.err.join('\n')).toContain('Usage: goose work');
  });
});

describe('workStatusCommand — WORK_MACHINE=true happy path', () => {
  it('lists Work projects and their open Jira tickets', async () => {
    mockedLoadProjects.mockResolvedValue([
      {
        slug: 'pay',
        name: 'Payments',
        id: 'pay',
        source: { kind: 'jira', projectKey: 'PAY' },
      } as unknown as ProjectConfig,
      {
        slug: 'gh-only',
        source: { kind: 'github', repo: 'shaunnez/x' },
      } as unknown as ProjectConfig,
    ]);
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workStatusCommand(io);
    expect(exit).toBe(0);
    const all = io.out.join('\n');
    expect(all).toContain('Payments (PAY)');
    expect(all).toContain('PAY-1');
    expect(all).toContain('factory:accepted');
    expect(all).toContain('PAY-2');
    expect(all).not.toContain('gh-only');
  });

  it('reports "no Work projects registered" gracefully', async () => {
    mockedLoadProjects.mockResolvedValue([
      {
        slug: 'gh-only',
        source: { kind: 'github', repo: 'shaunnez/x' },
      } as unknown as ProjectConfig,
    ]);
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workStatusCommand(io);
    expect(exit).toBe(0);
    expect(io.out.join('\n')).toContain('No Work projects registered');
  });
});

describe('workInvestigateCommand — WORK_MACHINE=true happy path', () => {
  it('requires slug + jira-key', async () => {
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workInvestigateCommand([], io);
    expect(exit).toBe(1);
    expect(io.err.join('\n')).toContain('Usage: goose work investigate');
  });

  it('rejects an unknown slug', async () => {
    mockedLoadProjects.mockResolvedValue([]);
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workInvestigateCommand(['missing', 'PAY-1'], io);
    expect(exit).toBe(1);
    expect(io.err.join('\n')).toContain('No Work project registered with slug "missing"');
  });

  it('triggers investigation for a known Work slug + Jira key', async () => {
    mockedLoadProjects.mockResolvedValue([
      {
        slug: 'pay',
        name: 'Payments',
        id: 'pay',
        source: { kind: 'jira', projectKey: 'PAY' },
      } as unknown as ProjectConfig,
    ]);
    const io = mkIo({ WORK_MACHINE: 'true' });
    const exit = await workInvestigateCommand(['pay', 'PAY-7'], io);
    expect(exit).toBe(0);
    expect(io.out.join('\n')).toContain('Triggering investigation for PAY-7');
  });
});

describe('workHelpLines', () => {
  it('returns at least the documented commands', () => {
    const lines = workHelpLines();
    expect(lines.join('\n')).toContain('work status');
    expect(lines.join('\n')).toContain('work investigate');
  });
});
