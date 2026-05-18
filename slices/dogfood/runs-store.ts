import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DogfoodRun, DogfoodRunPatch } from './outcome.js';

const DEFAULT_STORE_DIR = path.join(os.homedir(), '.factory', 'dogfood');
const DEFAULT_STORE_FILE = 'runs.jsonl';

export interface RunsStoreOptions {
  /** Directory the store file lives in. Defaults to `~/.factory/dogfood`. */
  dir?: string;
  /** File name within `dir`. Defaults to `runs.jsonl`. */
  file?: string;
}

export class RunsStore {
  readonly path: string;

  constructor(opts: RunsStoreOptions = {}) {
    const dir = opts.dir ?? DEFAULT_STORE_DIR;
    const file = opts.file ?? DEFAULT_STORE_FILE;
    this.path = path.join(dir, file);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
  }

  /** Append a fresh run row. Throws if `runId` already exists. */
  async append(run: DogfoodRun): Promise<void> {
    await this.ensureDir();
    const existing = await this.list();
    if (existing.some((r) => r.runId === run.runId)) {
      throw new Error(`runId already exists in store: ${run.runId}`);
    }
    await fs.appendFile(this.path, `${JSON.stringify(run)}\n`, 'utf8');
  }

  /** Replace one row in place by `runId`. Throws if not found. */
  async update(runId: string, patch: DogfoodRunPatch): Promise<DogfoodRun> {
    await this.ensureDir();
    const rows = await this.list();
    const idx = rows.findIndex((r) => r.runId === runId);
    if (idx < 0) throw new Error(`runId not found in store: ${runId}`);
    const updated: DogfoodRun = {
      ...rows[idx],
      ...patch,
      runId: rows[idx].runId,
      startedAt: rows[idx].startedAt,
    };
    rows[idx] = updated;
    const body = rows.map((r) => JSON.stringify(r)).join('\n');
    await fs.writeFile(this.path, rows.length > 0 ? `${body}\n` : '', 'utf8');
    return updated;
  }

  /** Return all rows in insertion order. */
  async list(): Promise<DogfoodRun[]> {
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as DogfoodRun);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async get(runId: string): Promise<DogfoodRun | undefined> {
    const rows = await this.list();
    return rows.find((r) => r.runId === runId);
  }

  /** Most-recent-first. */
  async listRecent(limit = 20): Promise<DogfoodRun[]> {
    const rows = await this.list();
    return rows.slice(-limit).reverse();
  }
}

export interface AggregateStats {
  total: number;
  pending: number;
  reachedTerminal: number;
  failed: number;
  truthPassRate?: number;
  qaCorrectRate?: number;
  hygieneCleanRate?: number;
  byWorkflow: Record<string, { total: number; reachedTerminal: number }>;
  bySeed: Record<string, { total: number; reachedTerminal: number; truthPassCount: number }>;
}

export function aggregate(rows: DogfoodRun[]): AggregateStats {
  const total = rows.length;
  let pending = 0;
  let reachedTerminal = 0;
  let failed = 0;
  let truthPassCount = 0;
  let truthSeen = 0;
  let qaCorrectCount = 0;
  let qaSeen = 0;
  let hygieneCleanCount = 0;
  let hygieneSeen = 0;
  const byWorkflow: AggregateStats['byWorkflow'] = {};
  const bySeed: AggregateStats['bySeed'] = {};

  for (const r of rows) {
    if (r.completion === 'pending') pending += 1;
    else if (r.completion === 'reached-terminal') reachedTerminal += 1;
    else failed += 1;
    if (typeof r.truthPass === 'boolean') {
      truthSeen += 1;
      if (r.truthPass) truthPassCount += 1;
    }
    if (typeof r.qaCorrect === 'boolean') {
      qaSeen += 1;
      if (r.qaCorrect) qaCorrectCount += 1;
    }
    if (typeof r.hygieneClean === 'boolean') {
      hygieneSeen += 1;
      if (r.hygieneClean) hygieneCleanCount += 1;
    }
    const wf = byWorkflow[r.workflow] ?? { total: 0, reachedTerminal: 0 };
    wf.total += 1;
    if (r.completion === 'reached-terminal') wf.reachedTerminal += 1;
    byWorkflow[r.workflow] = wf;
    const seed = bySeed[r.seedId] ?? { total: 0, reachedTerminal: 0, truthPassCount: 0 };
    seed.total += 1;
    if (r.completion === 'reached-terminal') seed.reachedTerminal += 1;
    if (r.truthPass === true) seed.truthPassCount += 1;
    bySeed[r.seedId] = seed;
  }

  return {
    total,
    pending,
    reachedTerminal,
    failed,
    truthPassRate: truthSeen > 0 ? truthPassCount / truthSeen : undefined,
    qaCorrectRate: qaSeen > 0 ? qaCorrectCount / qaSeen : undefined,
    hygieneCleanRate: hygieneSeen > 0 ? hygieneCleanCount / hygieneSeen : undefined,
    byWorkflow,
    bySeed,
  };
}
