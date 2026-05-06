import { parseDependencies } from '../state-source/dependency-parser.js';

export type DepMoveMode = 'with-dependencies' | 'ignore-dependencies';

export interface DepInfo {
  repoRef: string;
  issueNumber: number;
  lifecycle: 'open' | 'closed';
}

export interface MoveWithDepsResult {
  depsMoved: DepInfo[];
  depsSkipped: DepInfo[];
}

export type FetchLifecycleFn = (repoRef: string, issueNumber: number) => Promise<'open' | 'closed'>;

export type SetScheduleFn = (
  repoRef: string,
  issueNumber: number,
  schedule: string,
) => Promise<void>;

/**
 * Move an issue to schedule:current, optionally moving its open dependencies too.
 *
 * Classification:
 *  - closed deps are always skipped (already satisfied)
 *  - open deps: moved when mode='with-dependencies', skipped when 'ignore-dependencies'
 *
 * The issue itself is always moved regardless of mode.
 */
export async function moveIssueToCurrent(
  itemBody: string,
  currentRepo: string,
  currentIssueNumber: number,
  mode: DepMoveMode,
  fetchLifecycle: FetchLifecycleFn,
  setSchedule: SetScheduleFn,
): Promise<MoveWithDepsResult> {
  const refs = parseDependencies(itemBody).filter((r) => r.type === 'depends-on');

  const depInfos: DepInfo[] = await Promise.all(
    refs.map(async (ref) => {
      const repoRef = ref.repoRef ?? currentRepo;
      const lifecycle = await fetchLifecycle(repoRef, ref.issueNumber);
      return { repoRef, issueNumber: ref.issueNumber, lifecycle };
    }),
  );

  const openDeps = depInfos.filter((d) => d.lifecycle === 'open');
  const closedDeps = depInfos.filter((d) => d.lifecycle === 'closed');

  const depsMoved: DepInfo[] = [];
  const depsSkipped: DepInfo[] = [...closedDeps];

  if (mode === 'with-dependencies') {
    for (const dep of openDeps) {
      await setSchedule(dep.repoRef, dep.issueNumber, 'current');
      depsMoved.push(dep);
    }
  } else {
    depsSkipped.push(...openDeps);
  }

  await setSchedule(currentRepo, currentIssueNumber, 'current');

  return { depsMoved, depsSkipped };
}
