import type { AgentSpec } from './interface.js';

// Holdout roles that enforce strict context isolation
const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);
// Keys managed by the runtime itself — not user-injected, so not violations
export const SYSTEM_KEYS: ReadonlySet<string> = new Set(['projectId', 'workItemId']);

/**
 * Context keys produced by the dev-review pipeline (M19.11) that must NEVER
 * reach a holdout role's context — even if a future caller adds them to the
 * allowlist by mistake. Defense in depth: the allowlist mechanism is the
 * primary gate, this set is the backstop.
 *
 * `findHoldoutContextLeaks()` rejects holdout specs that mention these keys
 * either in `context` or in `contextAllowlist`. ADR 0036 §holdout-discipline.
 */
export const HOLDOUT_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'devReviewFindings',
  'devReviewVerdict',
  'devReviewSummaries',
]);

export interface HoldoutContextLeak {
  key: string;
  source: 'context' | 'allowlist';
}

/**
 * Returns the top-level key of an allowlist entry. `renderContext` supports
 * dotted paths (e.g. `devReviewFindings.summary`) which project a nested
 * value through to the rendered XML — so leak detection must normalise to
 * the top-level key before comparing against the forbidden set.
 */
function topLevelKey(allowlistEntry: string): string {
  const dot = allowlistEntry.indexOf('.');
  return dot === -1 ? allowlistEntry : allowlistEntry.slice(0, dot);
}

/**
 * For holdout roles only: returns the list of forbidden-key leaks present in
 * either `spec.context` or `spec.contextAllowlist`. Empty array for safe
 * specs and for non-holdout roles.
 *
 * Pure function — does not mutate the spec or emit events. Callers
 * (e.g. `assembleSpawnContext`) are responsible for the side effects.
 */
export function findHoldoutContextLeaks(spec: AgentSpec): HoldoutContextLeak[] {
  if (!HOLDOUT_ROLES.has(spec.role)) return [];
  const leaks: HoldoutContextLeak[] = [];
  for (const k of Object.keys(spec.context)) {
    if (HOLDOUT_FORBIDDEN_KEYS.has(k)) leaks.push({ key: k, source: 'context' });
  }
  for (const k of spec.contextAllowlist) {
    // Compare the top-level key against the forbidden set. `key` on the leak
    // record preserves the original entry (e.g. `devReviewFindings.summary`)
    // so the violation event accurately reports what the caller attempted.
    if (HOLDOUT_FORBIDDEN_KEYS.has(topLevelKey(k))) {
      leaks.push({ key: k, source: 'allowlist' });
    }
  }
  return leaks;
}

/**
 * Returns keys in `context` that are not in the `allowlist` and are not
 * system-managed keys (SYSTEM_KEYS). These are disallowed user-injected keys.
 *
 * Pure function — emitting events is the caller's responsibility.
 */
export function findDisallowedKeys(
  context: Record<string, unknown>,
  allowlist: string[],
): string[] {
  if (allowlist.length === 0) return [];
  const exactKeys = new Set<string>();
  const dottedTopKeys = new Set<string>();
  for (const entry of allowlist) {
    const dot = entry.indexOf('.');
    if (dot === -1) {
      exactKeys.add(entry);
    } else {
      dottedTopKeys.add(entry.slice(0, dot));
    }
  }
  const disallowed: string[] = [];
  for (const k of Object.keys(context)) {
    if (exactKeys.has(k) || SYSTEM_KEYS.has(k)) continue;
    // A dotted allowlist entry (e.g. workItem.title) only covers the top-level
    // key when the value is an object — if it's scalar/null, renderContext cannot
    // project the sub-path and the key must be flagged as disallowed.
    if (dottedTopKeys.has(k) && typeof context[k] === 'object' && context[k] !== null) continue;
    disallowed.push(k);
  }
  return disallowed;
}
