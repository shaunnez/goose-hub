import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  discoverPackageRoots,
  normalizeRepoRelativePath,
} from '@goose-hub/core/workspaces/path-normalization.js';
import {
  CONSTRAINT_SOURCE_PATTERN,
  type EngineeringSpec,
  fileOwnedPath,
  fileOwnedStatus,
} from './schema.js';

/**
 * Engineering Spec validators (M19.02, issue #559).
 *
 * Layered above schema-shape validation: applies the structural rules
 * Steve calls out at `01-planning-phase.md:302-314` plus the M19-issue-
 * specific rules (file-ownership full-stop, constraint inventory cites
 * real code, risk-on-auth path, AC-without-journey rejection).
 *
 * Returns `{ ok: true }` on success, `{ ok: false, errors: [...] }` on
 * failure. Errors are structured so the orchestrator can surface them
 * without re-parsing.
 */

export type ValidationError = {
  rule: ValidationRule;
  message: string;
  /** Optional context: WP id, AC id, file path, etc. */
  ref?: string;
};

export type ValidationRule =
  | 'wp-placeholder-path'
  | 'file-ownership-collision'
  | 'ac-orphan-without-journey'
  | 'ac-journey-ref-not-found'
  | 'ac-step-idx-out-of-range'
  | 'risk-required-on-sensitive-path'
  | 'constraint-source-format'
  | 'constraint-source-file-missing'
  | 'constraint-source-symbol-missing'
  | 'wp-dependson-not-found'
  | 'wp-dependson-order-invalid'
  | 'execution-order-wp-mismatch'
  | 'self-check-journey-coverage'
  | 'self-check-grounded-in-code'
  | 'self-check-complete-interfaces'
  | 'self-check-falsifiable-acs'
  | 'self-check-builder-independence'
  | 'self-check-verification-tooling'
  | 'verification-tool-command-malformed'
  | 'verification-tool-command-package-relative'
  | 'wp-missing-test-file'
  | 'wp-e2e-owned-for-product';

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] };

export interface ValidationOptions {
  /**
   * Repo root used to resolve constraint `source` file references. Required
   * for the `constraint-source-file-missing` and `*-symbol-missing` rules.
   * When omitted, those rules are skipped (useful in unit tests with no
   * filesystem).
   */
  repoRoot?: string;
  /**
   * Issue type — `'feature'` makes the AC→Journey map mandatory; `'bug'`
   * makes it advisory. Default `'feature'` (strict).
   */
  issueType?: 'feature' | 'bug';
  /** Override sensitive-path regex; default matches `auth|session|crypto|secret`. */
  sensitivePathPattern?: RegExp;
  /**
   * Spec mode — `'lite'` relaxes interfaceContracts and riskRegister requirements
   * for T1/T2 single-WP specs; both arrays may be empty. Default `'full'`.
   */
  specMode?: 'lite' | 'full';
}

const DEFAULT_SENSITIVE_PATTERN = /(auth|session|crypto|secret)/i;
const BARE_REPO_PATH_PATTERN = /^(?:\.\/)?[\w@./-]+\.[A-Za-z0-9]+$/;
const WEB_E2E_SPEC_PATTERN = /^apps\/web\/e2e\/.*\.spec\.ts$/;
const PLACEHOLDER_ANGLE_PATTERN = /<[^/][^>]*>/;
const PROSE_PATH_SEGMENT_PATTERN = /(?:^|\/)[^/]*\s+[^/]*(?:$|\/)/;

function placeholderPathReason(path: string): string | null {
  if (path.includes('...')) return 'contains ellipsis placeholder';
  if (PLACEHOLDER_ANGLE_PATTERN.test(path)) return 'contains angle-bracket placeholder';
  if (PROSE_PATH_SEGMENT_PATTERN.test(path)) return 'contains prose path segment';
  return null;
}

function isBareRepoPathCommand(command: string): boolean {
  const trimmed = command.trim();
  return !/\s/.test(trimmed) && BARE_REPO_PATH_PATTERN.test(trimmed) && trimmed.includes('/');
}

function commandPathTokens(command: string): string[] {
  const tokens = command
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((token) => token.replace(/^['"`]/, '').replace(/['"`]$/, ''));
  return tokens.filter(
    (token) =>
      !token.startsWith('-') &&
      token.includes('/') &&
      BARE_REPO_PATH_PATTERN.test(token) &&
      !token.includes('*'),
  );
}

export function validateEngineeringSpec(
  spec: EngineeringSpec,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];
  const issueType = options.issueType ?? 'feature';
  const sensitivePattern = options.sensitivePathPattern ?? DEFAULT_SENSITIVE_PATTERN;
  const specMode = options.specMode ?? 'full';
  const isLiteSingleWp = specMode === 'lite' && spec.workPackages.length <= 1;

  // ── File ownership: same path may not appear in two WPs (full-stop). ──
  const ownerByPath = new Map<string, string>();
  for (const wp of spec.workPackages) {
    for (const entry of wp.filesOwned) {
      const path = fileOwnedPath(entry);
      const placeholderReason = placeholderPathReason(path);
      if (placeholderReason != null) {
        errors.push({
          rule: 'wp-placeholder-path',
          message: `WP '${wp.id}' filesOwned path '${path}' is not a concrete repo-root path: ${placeholderReason}`,
          ref: path,
        });
      }
      const prior = ownerByPath.get(path);
      if (prior != null && prior !== wp.id) {
        errors.push({
          rule: 'file-ownership-collision',
          message: `file '${path}' is owned by both ${prior} and ${wp.id}; one WP must own it (Steve 03-lifecycle-harness.md:155)`,
          ref: path,
        });
      } else {
        ownerByPath.set(path, wp.id);
      }
    }
  }

  // ── AC → Journey discipline (mandatory for type:feature). ──
  const journeyById = new Map(spec.userJourneys.map((j) => [j.id, j]));
  for (const ac of spec.acceptanceCriteria) {
    if (ac.crossCutting === true) continue;
    if (ac.journeyRef == null && issueType === 'feature') {
      errors.push({
        rule: 'ac-orphan-without-journey',
        message: `AC '${ac.id}' has no journeyRef and is not crossCutting (issueType=feature)`,
        ref: ac.id,
      });
      continue;
    }
    if (ac.journeyRef != null) {
      const journey = journeyById.get(ac.journeyRef);
      if (journey == null) {
        errors.push({
          rule: 'ac-journey-ref-not-found',
          message: `AC '${ac.id}' references journey '${ac.journeyRef}' which is not in userJourneys`,
          ref: ac.id,
        });
      } else if (ac.stepIdx != null && !journey.steps.some((s) => s.idx === ac.stepIdx)) {
        errors.push({
          rule: 'ac-step-idx-out-of-range',
          message: `AC '${ac.id}' references step idx ${ac.stepIdx} which is not in journey '${ac.journeyRef}'`,
          ref: ac.id,
        });
      }
    }
  }

  // ── Sensitive-path risk-register requirement. ──
  const allFilesOwned = spec.workPackages.flatMap((wp) => wp.filesOwned.map(fileOwnedPath));
  const sensitiveTouches = allFilesOwned.filter((p) => sensitivePattern.test(p));
  if (sensitiveTouches.length > 0 && spec.riskRegister.length === 0 && !isLiteSingleWp) {
    errors.push({
      rule: 'risk-required-on-sensitive-path',
      message: `spec touches sensitive path(s) ${sensitiveTouches.join(', ')} but riskRegister is empty (≥1 risk required)`,
      ref: sensitiveTouches[0],
    });
  }

  // ── Constraint inventory: source format + (optional) filesystem check. ──
  for (const constraint of spec.constraints) {
    const m = constraint.source.match(CONSTRAINT_SOURCE_PATTERN);
    if (m == null) {
      errors.push({
        rule: 'constraint-source-format',
        message: `constraint '${constraint.name}' source '${constraint.source}' is not 'path:line' or 'path:symbol' format`,
        ref: constraint.name,
      });
      continue;
    }
    if (options.repoRoot != null) {
      const filePath = m[1];
      const ref = m[2];
      const abs = join(options.repoRoot, filePath);
      if (!existsSync(abs)) {
        errors.push({
          rule: 'constraint-source-file-missing',
          message: `constraint '${constraint.name}' cites '${filePath}' which does not exist`,
          ref: constraint.name,
        });
        continue;
      }
      // Symbol check (if `ref` is non-numeric): grep the file for the symbol.
      if (!/^\d+$/.test(ref)) {
        const contents = readFileSync(abs, 'utf8');
        if (!contents.includes(ref)) {
          errors.push({
            rule: 'constraint-source-symbol-missing',
            message: `constraint '${constraint.name}' cites symbol '${ref}' in '${filePath}' which is not present`,
            ref: constraint.name,
          });
        }
      }
    }
  }

  // ── DAG integrity: dependsOn refs must point to real WPs. ──
  const wpIds = new Set(spec.workPackages.map((wp) => wp.id));
  for (const wp of spec.workPackages) {
    for (const dep of wp.dependsOn) {
      if (!wpIds.has(dep)) {
        errors.push({
          rule: 'wp-dependson-not-found',
          message: `WP '${wp.id}' dependsOn '${dep}' which is not a known WP`,
          ref: wp.id,
        });
      }
    }
  }

  // ── Execution order must enumerate every WP exactly once. ──
  const orderedIds = spec.executionOrder.flatMap((b) => b.wpIds);
  const orderedSet = new Set(orderedIds);
  if (orderedIds.length !== orderedSet.size) {
    errors.push({
      rule: 'execution-order-wp-mismatch',
      message: 'executionOrder lists a WP id more than once',
    });
  }
  for (const id of wpIds) {
    if (!orderedSet.has(id)) {
      errors.push({
        rule: 'execution-order-wp-mismatch',
        message: `WP '${id}' is missing from executionOrder`,
        ref: id,
      });
    }
  }
  for (const id of orderedIds) {
    if (!wpIds.has(id)) {
      errors.push({
        rule: 'execution-order-wp-mismatch',
        message: `executionOrder references unknown WP '${id}'`,
        ref: id,
      });
    }
  }
  const batchByWp = new Map<string, number>();
  for (const order of spec.executionOrder) {
    for (const wpId of order.wpIds) {
      batchByWp.set(wpId, order.batch);
    }
  }
  for (const wp of spec.workPackages) {
    const wpBatch = batchByWp.get(wp.id);
    if (wpBatch == null) continue;
    for (const dep of wp.dependsOn) {
      const depBatch = batchByWp.get(dep);
      if (depBatch == null) continue;
      if (depBatch >= wpBatch) {
        errors.push({
          rule: 'wp-dependson-order-invalid',
          message: `WP '${wp.id}' dependsOn '${dep}', but dependencies must appear in an earlier execution batch`,
          ref: wp.id,
        });
      }
    }
  }

  // ── Steve's 6 self-checks (01-planning-phase.md:319-327). ──
  // 1. Journey coverage — every journey step has at least one AC.
  if (issueType === 'feature') {
    for (const journey of spec.userJourneys) {
      for (const step of journey.steps) {
        const covered = spec.acceptanceCriteria.some(
          (ac) => ac.journeyRef === journey.id && ac.stepIdx === step.idx,
        );
        if (!covered) {
          errors.push({
            rule: 'self-check-journey-coverage',
            message: `journey '${journey.id}' step ${step.idx} has no AC`,
            ref: `${journey.id}#${step.idx}`,
          });
        }
      }
    }
  }

  // 4. Falsifiable ACs — criteria may be judged by Review without an executable
  //    check, but any executable check that is present must be runnable.
  for (const ac of spec.acceptanceCriteria) {
    for (const check of ac.executableChecks ?? []) {
      if (isBareRepoPathCommand(check.command)) {
        errors.push({
          rule: 'verification-tool-command-malformed',
          message: `AC '${ac.id}' executable check '${check.id}' is a bare file path, not an executable command`,
          ref: ac.id,
        });
      }
      const pathTokens = commandPathTokens(check.command);
      for (const token of pathTokens) {
        if (options.repoRoot == null) continue;
        const normalized = normalizeRepoRelativePath({
          rawPath: token,
          worktreePath: options.repoRoot,
          packageRoots: discoverPackageRoots(options.repoRoot),
          referencePaths: allFilesOwned,
        });
        if (normalized.source === 'package-root') {
          errors.push({
            rule: 'verification-tool-command-package-relative',
            message: `AC '${ac.id}' executable check '${check.id}' uses package-relative path '${token}'; use repo-root path '${normalized.path}'`,
            ref: ac.id,
          });
        }
      }
    }
  }

  // 5. Builder independence — every WP must declare ≥1 file owned (already
  //    enforced via `min(1)` in schema). We also surface a soft check that
  //    the changes string is non-trivial.
  for (const wp of spec.workPackages) {
    if (wp.changes.trim().length < 16) {
      errors.push({
        rule: 'self-check-builder-independence',
        message: `WP '${wp.id}' changes description is too short to be builder-actionable`,
        ref: wp.id,
      });
    }
  }

  // TDD contract — WP that owns production .ts/.tsx files must also own a test file.
  // Exempt: *.test.ts/x, *.spec.ts/x, *.config.ts, *.d.ts, *types.ts, *schema.ts, *index.ts
  const EXEMPT_SUFFIX =
    /\.(test|spec)\.(ts|tsx)$|\.(config|d)\.ts$|(types?|interfaces?|schema|index|constants?|errors?)\.(ts|tsx)$/;
  const isProductionTs = (f: string) =>
    (f.endsWith('.ts') || f.endsWith('.tsx')) && !EXEMPT_SUFFIX.test(f);
  const isTestFile = (f: string) => /\.(test|spec)\.(ts|tsx)$/.test(f);
  const isWebE2eSpec = (f: string) => WEB_E2E_SPEC_PATTERN.test(f.replace(/^\.\//, ''));
  const isExplicitE2eWp = (wp: EngineeringSpec['workPackages'][number]) =>
    /\b(e2e|playwright|test[- ]?infra|test infrastructure)\b/i.test(`${wp.id} ${wp.changes}`);
  for (const wp of spec.workPackages) {
    const paths = wp.filesOwned.map(fileOwnedPath);
    const hasProductionTs = paths.some(isProductionTs);
    const hasTestFile = paths.some(isTestFile);
    const e2eSpecs = paths.filter(isWebE2eSpec);
    if (e2eSpecs.length > 0 && !isExplicitE2eWp(wp)) {
      errors.push({
        rule: 'wp-e2e-owned-for-product',
        message: `WP '${wp.id}' owns e2e spec path(s) ${e2eSpecs.join(', ')} without explicit e2e/test-infra scope; product WPs should use unit/component tests and leave e2e to QA/evidence`,
        ref: wp.id,
      });
    }
    if (hasProductionTs && !hasTestFile) {
      errors.push({
        rule: 'wp-missing-test-file',
        message: `WP '${wp.id}' owns production .ts files but no *.test.ts or *.spec.ts — add the test file to filesOwned or split TDD into a separate WP`,
        ref: wp.id,
      });
    }
  }

  // 6. Verification tooling required when more than 2 WPs.
  if (spec.workPackages.length > 2 && spec.verificationTooling.length === 0) {
    errors.push({
      rule: 'self-check-verification-tooling',
      message: `${spec.workPackages.length} WPs in spec but verificationTooling is empty (Steve self-check #6)`,
    });
  }

  for (const [index, tool] of spec.verificationTooling.entries()) {
    if (isBareRepoPathCommand(tool.command)) {
      errors.push({
        rule: 'verification-tool-command-malformed',
        message: `verificationTooling[${index}].command must be an executable command, not a bare file path: ${tool.command}`,
        ref: `verificationTooling[${index}].command`,
      });
    }
    if (options.repoRoot != null) {
      const packageRoots = discoverPackageRoots(options.repoRoot);
      for (const pathToken of commandPathTokens(tool.command)) {
        if (existsSync(join(options.repoRoot, pathToken))) continue;
        const normalized = normalizeRepoRelativePath({
          rawPath: pathToken,
          worktreePath: options.repoRoot,
          packageRoots,
        });
        if (normalized.source === 'package-root') {
          errors.push({
            rule: 'verification-tool-command-package-relative',
            message: `verificationTooling[${index}].command uses package-relative path '${pathToken}'; use repo-root path '${normalized.path}'`,
            ref: `verificationTooling[${index}].command`,
          });
        }
      }
    }
  }

  // 3. Complete interfaces — every cross-WP boundary has a typed contract.
  // Heuristic: if ≥2 WPs exist, at least one InterfaceContract must be
  // declared. In lite mode (T1/T2 single-WP), empty interfaceContracts are permitted.
  if (spec.workPackages.length >= 2 && spec.interfaceContracts.length === 0 && !isLiteSingleWp) {
    errors.push({
      rule: 'self-check-complete-interfaces',
      message: `${spec.workPackages.length} WPs in spec but interfaceContracts is empty — cross-WP boundaries need typed contracts`,
    });
  }

  // 2. Grounded in code — per-file existence check. Production files under
  //    apps/, core/, slices/, skills/ must exist in the worktree OR be
  //    annotated { status: 'new' }. Test, config, and .d.ts files are exempt.
  const GROUNDABLE_SCOPE_RE = /^(apps|core|slices|skills)\//;
  const EXEMPT_SUFFIX_FOR_GROUNDING = /\.(test|spec)\.(ts|tsx)$|\.(config|d)\.ts$/;

  if (options.repoRoot != null) {
    const repoRoot = options.repoRoot;
    for (const wp of spec.workPackages) {
      for (const entry of wp.filesOwned) {
        const path = fileOwnedPath(entry);
        const status = fileOwnedStatus(entry);
        if (status === 'new') continue;
        if (!GROUNDABLE_SCOPE_RE.test(path)) continue;
        if (EXEMPT_SUFFIX_FOR_GROUNDING.test(path)) continue;
        if (existsSync(join(repoRoot, path))) continue;
        errors.push({
          rule: 'self-check-grounded-in-code',
          message: `WP '${wp.id}' filesOwned path '${path}' does not exist in worktree and is not annotated status:'new'. Either fix the path or declare it as a new file.`,
          ref: wp.id,
        });
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
