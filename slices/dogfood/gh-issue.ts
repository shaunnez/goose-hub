import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GhIssueCreateInput {
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

export interface GhIssue {
  number: number;
  url: string;
}

export class GhNotInstalledError extends Error {
  constructor() {
    super('`gh` CLI is not installed or not on PATH. Install: https://cli.github.com/');
    this.name = 'GhNotInstalledError';
  }
}

export class GhNotAuthenticatedError extends Error {
  constructor(detail: string) {
    super(`\`gh\` CLI is not authenticated.\n${detail}\nRun: gh auth login`);
    this.name = 'GhNotAuthenticatedError';
  }
}

export class GhCommandError extends Error {
  constructor(
    readonly command: string,
    readonly stderr: string,
    readonly stdout: string,
  ) {
    super(`gh command failed: ${command}\nstderr: ${stderr}`);
    this.name = 'GhCommandError';
  }
}

/** Subset of `execFile` we depend on. Injected for tests. */
export type ExecFileFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface GhClientOptions {
  exec?: ExecFileFn;
}

export class GhClient {
  private readonly exec: ExecFileFn;

  constructor(opts: GhClientOptions = {}) {
    this.exec = opts.exec ?? ((file, args) => execFileAsync(file, args, { encoding: 'utf8' }));
  }

  async assertReady(): Promise<void> {
    try {
      await this.exec('gh', ['--version']);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') throw new GhNotInstalledError();
      throw err;
    }
    try {
      await this.exec('gh', ['auth', 'status']);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new GhNotAuthenticatedError(stderr);
    }
  }

  /**
   * Create a GitHub issue and return its number + URL.
   * Uses `gh issue create --json url,number` for parseable output.
   */
  async createIssue(input: GhIssueCreateInput): Promise<GhIssue> {
    const args = [
      'issue',
      'create',
      '--repo',
      input.repo,
      '--title',
      input.title,
      '--body',
      input.body,
    ];
    for (const label of input.labels) {
      args.push('--label', label);
    }
    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await this.exec('gh', args));
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: string };
      if (e.code === 'ENOENT') throw new GhNotInstalledError();
      throw new GhCommandError('gh issue create', e.stderr ?? '', e.stdout ?? '');
    }
    return parseIssueCreateOutput(stdout, stderr);
  }
}

/**
 * `gh issue create` prints the issue URL on stdout as its last line.
 * Older gh versions print only the URL; newer add other content. Be tolerant.
 */
export function parseIssueCreateOutput(stdout: string, _stderr: string): GhIssue {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const urlLine = [...lines].reverse().find((l) => /^https?:\/\/.+\/issues\/\d+/.test(l));
  if (!urlLine) {
    throw new Error(`Could not find issue URL in gh stdout:\n${stdout}`);
  }
  const m = urlLine.match(/(https?:\/\/[^\s]+\/issues\/(\d+))/);
  if (!m) throw new Error(`Could not parse issue URL line: ${urlLine}`);
  return { url: m[1], number: Number(m[2]) };
}
