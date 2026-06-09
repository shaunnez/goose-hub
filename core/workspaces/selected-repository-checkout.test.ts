import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkItem } from '../state-source/interface.js';
import type { ProjectConfig } from '../types.js';
import { resolveSelectedRepositoryCheckout } from './selected-repository-checkout.js';

const tempDirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'selected-repository-checkout-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveSelectedRepositoryCheckout', () => {
  it('uses configured repository paths for non-local work items without managed checkout', () => {
    const repoPath = tempRepo();
    const fallbackPath = tempRepo();
    const project = {
      id: 'proj',
      repositories: [
        {
          repoRef: 'owner/app',
          cloneUrl: 'git@github.com:owner/app.git',
          localPath: repoPath,
          defaultBranch: 'trunk',
          role: 'code',
        },
      ],
    } as ProjectConfig;
    const workItem = {
      id: 'github:owner/app#12',
      externalId: '12',
      repoRef: 'owner/app',
      title: 'Use app repo',
      body: '',
      state: 'factory:dev-ready',
      schedule: 'current',
      type: 'bug',
    } as WorkItem;

    const selected = resolveSelectedRepositoryCheckout({
      project,
      workItem,
      fallbackLocalPath: fallbackPath,
    });

    expect(selected.localPath).toBe(repoPath);
    expect(selected.defaultBranch).toBe('trunk');
    expect(selected.checkoutSource).toBe('configured-local-path');
    expect(selected.readiness).toBeUndefined();
  });
});
