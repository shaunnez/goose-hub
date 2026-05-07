import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineeringSpec } from './schema.js';

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
  | 'file-ownership-collision'
  | 'ac-orphan-without-journey'
  | 'ac-journey-ref-not-found'
  | 'ac-step-idx-out-of-range'
  | 'risk-required-on-sensitive-path'
  | 'constraint-source-format'
  | 'constraint-source-file-missing'
  | 'constraint-source-symbol-missing'
  | 'wp-dependson-not-found'
  | 'execution-order-wp-mismatch'
  | 'self-check-journey-coverage'
  | 'self-check-grounded-in-code'
  | 'self-check-complete-interfaces'
  | 'self-check-falsifiable-acs'
  | 'self-check-builder-independence'
  | 'self-check-verification-tooling';

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
}

const DEFAULT_SENSITIVE_PATTERN = /(auth|session|crypto|secret)/i;
const CONSTRAINT_SOURCE_PATTERN = /^([^\s:]+):(\d+|[A-Za-z_][\w-]*)$/;

export function validateEngineeringSpec(
  spec: EngineeringSpec,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: ValidationError[] = [];
  const issueType = options.issueType ?? 'feature';
  const sensitivePattern = options.sensitivePathPattern ?? DEFAULT_SENSITIVE_PATTERN;

  // ── File ownership: same path may not appear in two WPs (full-stop). ──
  const ownerByPath = new Map<string, string>();
  for (const wp of spec.workPackages) {
    for (const path of wp.filesOwned) {
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
  const allFilesOwned = spec.workPackages.flatMap((wp) => wp.filesOwned);
  const sensitiveTouches = allFilesOwned.filter((p) => sensitivePattern.test(p));
  if (sensitiveTouches.length > 0 && spec.riskRegister.length === 0) {
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

  // 4. Falsifiable ACs — covered by schema (`verifyCommand: z.string().min(1)`).

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

  // 6. Verification tooling required when more than 2 WPs.
  if (spec.workPackages.length > 2 && spec.verificationTooling.length === 0) {
    errors.push({
      rule: 'self-check-verification-tooling',
      message: `${spec.workPackages.length} WPs in spec but verificationTooling is empty (Steve self-check #6)`,
    });
  }

  // 3. Complete interfaces — every cross-WP boundary has a typed contract.
  // Heuristic: if ≥2 WPs exist, at least one InterfaceContract must be
  // declared.
  if (spec.workPackages.length >= 2 && spec.interfaceContracts.length === 0) {
    errors.push({
      rule: 'self-check-complete-interfaces',
      message: `${spec.workPackages.length} WPs in spec but interfaceContracts is empty — cross-WP boundaries need typed contracts`,
    });
  }

  // 2. Grounded in code — when repoRoot is provided, verify each WP file
  //    actually exists in the worktree. (Constraint source check above is
  //    a strict subset of this; this catches WP filesOwned that don't yet
  //    exist either.) Soft check: only fire on files that *should* already
  //    exist (not on files the WP plans to create). Since the spec doesn't
  //    distinguish create vs modify, we only emit a warning-level error
  //    when none of the WP's files exist. That suggests a typo, not a
  //    plan to create a new module.
  if (options.repoRoot != null) {
    const repoRoot = options.repoRoot;
    for (const wp of spec.workPackages) {
      const anyExists = wp.filesOwned.some((p) => existsSync(join(repoRoot, p)));
      // Skip when WP touches sensitive paths (likely brand-new modules).
      if (!anyExists && !wp.filesOwned.some((p) => sensitivePattern.test(p))) {
        // Soft signal — emit only if filesOwned ALL look like they should
        // exist (e.g. paths under existing directories) but none do.
        const allLookExisting = wp.filesOwned.every((p) => {
          const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
          return existsSync(join(repoRoot, dir));
        });
        if (allLookExisting) {
          errors.push({
            rule: 'self-check-grounded-in-code',
            message: `WP '${wp.id}' files do not exist in worktree but their parent dirs do — possible typo`,
            ref: wp.id,
          });
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
