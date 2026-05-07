/**
 * Governance file change checker.
 *
 * Implements rule 12 of FACTORY_RULES.md:
 *   - Governance files cannot be modified by any Factory-dispatched PR.
 *   - They can be created only in PRs tagged factory:bootstrap-pr.
 *
 * Governance perimeter:
 *   - MISSION.md (root)
 *   - FACTORY_RULES.md (root)
 *   - CLAUDE.md (root only)
 *   - target-projects/<slug>/project.config.ts
 *   - target-projects/<slug>/personas/**
 *   - target-projects/<slug>/MISSION.md (overlay)
 *   - target-projects/<slug>/FACTORY_RULES.md (overlay)
 */

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface ChangedFile {
  path: string;
  status: FileStatus;
}

export interface PrFileChange {
  filename: string;
  status: string;
  previous_filename?: string;
}

function normaliseStatus(s: string): FileStatus {
  switch (s) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'renamed':
      return 'renamed';
    default:
      return 'modified';
  }
}

/**
 * Expand the GitHub PR-files API response into ChangedFile entries.
 *
 * Renames are split into a `removed` of the previous path plus a `renamed` of
 * the new path. Without this, a rename of a governance file out of the perimeter
 * (e.g. MISSION.md -> docs/MISSION.md) would bypass the check because only the
 * new path is inspected.
 */
export function expandPrFileChanges(prFiles: PrFileChange[]): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const f of prFiles) {
    const status = normaliseStatus(f.status);
    if (status === 'renamed' && f.previous_filename && f.previous_filename !== f.filename) {
      out.push({ path: f.previous_filename, status: 'removed' });
    }
    out.push({ path: f.filename, status });
  }
  return out;
}

export interface Violation {
  path: string;
  reason: string;
}

export interface GovernanceCheckResult {
  ok: boolean;
  violations: Violation[];
}

/**
 * Returns true if the given path falls within the governance perimeter.
 */
export function isGovernancePath(path: string): boolean {
  // Root-level governance files (exact match)
  if (path === 'MISSION.md') return true;
  if (path === 'FACTORY_RULES.md') return true;
  if (path === 'CLAUDE.md') return true;

  // target-projects/<slug>/project.config.ts
  if (/^target-projects\/[^/]+\/project\.config\.ts$/.test(path)) return true;

  // target-projects/<slug>/personas/** (any depth)
  if (/^target-projects\/[^/]+\/personas\//.test(path)) return true;

  // target-projects/<slug>/MISSION.md overlay
  if (/^target-projects\/[^/]+\/MISSION\.md$/.test(path)) return true;

  // target-projects/<slug>/FACTORY_RULES.md overlay
  if (/^target-projects\/[^/]+\/FACTORY_RULES\.md$/.test(path)) return true;

  return false;
}

/**
 * Returns true if the given path is allowed to be ADDED on a bootstrap PR.
 *
 * Bootstrap PRs may add (not modify) files under target-projects/<slug>/ and
 * may add the root CLAUDE.md (initial creation only).
 */
export function isBootstrapAllowedAddition(path: string): boolean {
  // Adding root CLAUDE.md on bootstrap is allowed (initial project setup)
  if (path === 'CLAUDE.md') return true;

  // Adding any governance file under target-projects/<slug>/ is allowed
  if (/^target-projects\/[^/]+\//.test(path)) return true;

  return false;
}

/**
 * Check PR changed files against the governance perimeter.
 *
 * @param changes    List of files changed in the PR with their git status.
 * @param hasBootstrapLabel  Whether the PR carries the `factory:bootstrap-pr` label.
 * @returns GovernanceCheckResult — ok=true means the check passes.
 */
export function checkGovernance(
  changes: ChangedFile[],
  hasBootstrapLabel: boolean,
): GovernanceCheckResult {
  const violations: Violation[] = [];

  for (const file of changes) {
    if (!isGovernancePath(file.path)) {
      // Not a governance file — always fine.
      continue;
    }

    if (hasBootstrapLabel && file.status === 'added' && isBootstrapAllowedAddition(file.path)) {
      // Bootstrap PR adding a new governance file — allowed.
      continue;
    }

    // Everything else that touches a governance path is a violation.
    const action =
      file.status === 'added'
        ? 'Creation of governance file'
        : file.status === 'modified'
          ? 'Modification of governance file'
          : file.status === 'removed'
            ? 'Deletion of governance file'
            : 'Renaming of governance file';

    const hint =
      hasBootstrapLabel && file.status !== 'added'
        ? ' (bootstrap PRs may only ADD new governance files, not modify/remove/rename existing ones)'
        : !hasBootstrapLabel && file.status === 'added'
          ? ' (only factory:bootstrap-pr PRs may add governance files)'
          : '';

    violations.push({
      path: file.path,
      reason: `${action} \`${file.path}\` is not allowed.${hint}`,
    });
  }

  return { ok: violations.length === 0, violations };
}
