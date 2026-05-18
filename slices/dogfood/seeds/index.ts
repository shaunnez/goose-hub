import { seed as logger001 } from './logger-001-drop-meta.seed.js';
import type { Seed } from './types.js';

const SEEDS: Seed[] = [logger001];

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
