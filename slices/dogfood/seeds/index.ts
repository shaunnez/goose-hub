import { seed as backend001 } from './backend-001-budget-threshold.seed.js';
import { seed as frontend002 } from './frontend-002-truncate-boundary.seed.js';
import { seed as logger001 } from './logger-001-drop-meta.seed.js';
import type { Seed } from './types.js';

const SEEDS: Seed[] = [logger001, frontend002, backend001];

const byId = new Map<string, Seed>(SEEDS.map((s) => [s.id, s]));

export function listSeeds(): Seed[] {
  return [...SEEDS];
}

export function getSeed(id: string): Seed {
  const s = byId.get(id);
  if (!s) {
    const known = SEEDS.map((x) => x.id).join(', ') || '(none)';
    throw new Error(`Unknown seed: ${id}. Known: ${known}`);
  }
  return s;
}

export type { Seed } from './types.js';
