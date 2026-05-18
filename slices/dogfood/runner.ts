import { spawn } from 'node:child_process';
import { promises as fs, accessSync } from 'node:fs';
import path from 'node:path';
import { getSeed, listSeeds } from './seeds/index.js';
import type { Seed, SeedState, VerifyResult } from './seeds/types.js';

export interface RunnerOptions {
  repoRoot: string;
}

export interface SeedStatus {
  id: string;
  state: SeedState;
  description: string;
  area: string;
  error?: string;
}

export async function statusAll(opts: RunnerOptions): Promise<SeedStatus[]> {
  const out: SeedStatus[] = [];
  for (const s of listSeeds()) {
    try {
      const applied = await s.isApplied(opts.repoRoot);
      out.push({
        id: s.id,
        state: applied ? 'applied' : 'clean',
        description: s.description,
        area: s.area,
      });
    } catch (err) {
      out.push({
        id: s.id,
        state: 'unknown',
        description: s.description,
        area: s.area,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export async function applySeed(seedId: string, opts: RunnerOptions): Promise<Seed> {
  const seed = getSeed(seedId);
  await seed.apply(opts.repoRoot);
  return seed;
}

export async function restoreSeed(seedId: string, opts: RunnerOptions): Promise<Seed> {
  const seed = getSeed(seedId);
  await seed.restore(opts.repoRoot);
  return seed;
}

function findVitestBin(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    path.join(repoRoot, 'apps', 'web', 'node_modules', '.bin', 'vitest'),
  ];
  for (const c of candidates) {
    try {
      accessSync(c);
      return c;
    } catch {
      // continue
    }
  }
  return null;
}

interface VitestJsonResult {
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{
      fullName?: string;
      ancestorTitles?: string[];
      title?: string;
      status: 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';
    }>;
  }>;
}

function namesFromVitestJson(json: VitestJsonResult): { passing: string[]; failing: string[] } {
  const passing: string[] = [];
  const failing: string[] = [];
  for (const tr of json.testResults ?? []) {
    for (const a of tr.assertionResults ?? []) {
      const name =
        a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ''].filter(Boolean).join(' > ');
      if (a.status === 'failed') failing.push(name);
      else if (a.status === 'passed') passing.push(name);
    }
  }
  return { passing, failing };
}

export async function verifyRed(seedId: string, opts: RunnerOptions): Promise<VerifyResult> {
  const seed = getSeed(seedId);
  const vitest = findVitestBin(opts.repoRoot);
  if (!vitest) {
    throw new Error(
      `vitest not found in node_modules. Run \`pnpm install\` first. Expected at: ${path.join(opts.repoRoot, 'node_modules', '.bin', 'vitest')}`,
    );
  }
  const fullTestFile = path.join(opts.repoRoot, seed.truthSignal.testFile);
  await fs.access(fullTestFile);

  const json = await new Promise<VitestJsonResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(vitest, ['run', '--reporter=json', seed.truthSignal.testFile], {
      cwd: opts.repoRoot,
      env: process.env,
    });
    proc.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    proc.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    proc.on('error', reject);
    proc.on('close', () => {
      const trimmed = stdout.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start === -1 || end === -1) {
        reject(new Error(`vitest produced no JSON. stderr:\n${stderr}\nstdout:\n${stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(trimmed.slice(start, end + 1)) as VitestJsonResult);
      } catch (err) {
        reject(new Error(`failed to parse vitest JSON: ${(err as Error).message}`));
      }
    });
  });

  const { passing, failing } = namesFromVitestJson(json);
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[›>\s]+/g, ' ')
      .trim();
  const needle = normalize(seed.truthSignal.testName);
  const truthSignalRed = failing.some((n) => normalize(n).includes(needle));
  const unexpectedFailures = failing.filter((n) => !normalize(n).includes(needle));
  return {
    truthSignalRed,
    unexpectedFailures,
    failingTests: failing,
    passingTests: passing,
    raw: json,
  };
}

export function renderIssueBody(seed: Seed): string {
  return seed.issue.body;
}
