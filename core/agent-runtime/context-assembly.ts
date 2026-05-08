import { eventStore } from '../event-stream/store.js';
import type { AgentSpec } from './interface.js';

export interface SpawnContext {
  contextXml: string;
}

// Holdout roles that enforce strict context isolation
const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);
// Keys managed by the runtime itself — not user-injected, so not violations
const SYSTEM_KEYS = new Set(['projectId', 'workItemId']);

/**
 * Context keys produced by the dev-review pipeline (M19.11) that must NEVER
 * reach a holdout role's context — even if a future caller adds them to the
 * allowlist by mistake. Defense in depth: the allowlist mechanism is the
 * primary gate, this set is the backstop.
 *
 * `assertHoldoutContextSafe()` rejects holdout specs that mention these keys
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
 * For holdout roles only: returns the list of forbidden-key leaks present in
 * either `spec.context` or `spec.contextAllowlist`. Empty array for safe
 * specs and for non-holdout roles.
 *
 * Pure function — does not mutate the spec or emit events. Callers
 * (e.g. `assembleSpawnContext`) are responsible for the side effects.
 */
/**
 * Returns the top-level key of an allowlist entry. `renderManifest` supports
 * dotted paths (e.g. `devReviewFindings.summary`) which project a nested
 * value through to the rendered XML — so leak detection must normalise to
 * the top-level key before comparing against the forbidden set.
 */
function topLevelKey(allowlistEntry: string): string {
  const dot = allowlistEntry.indexOf('.');
  return dot === -1 ? allowlistEntry : allowlistEntry.slice(0, dot);
}

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
 * Centralised context injection point. All ambient injection routes through here.
 * When freshContext is true, only allowlist-filtered keys from spec.context are rendered —
 * no event-stream, persona history, or inbox injection. At M4, non-fresh path is identical.
 *
 * `spec.personaId` is accepted here and will be used to load persona history in M9+.
 * For now, the non-fresh path is a no-op stub.
 *
 * For holdout roles (qa, reviewer), any context key that is not in contextAllowlist and
 * is not a system-internal key (projectId, workItemId) triggers a tool.violation event.
 *
 * ESLint rule: any access to event-stream or persona-history from core/agent-runtime/
 * outside this file should be flagged (enforced manually until ESLint plugin is wired).
 */
export function assembleSpawnContext(spec: AgentSpec): SpawnContext {
  // personaId is available on spec for future M9 persona history injection.
  // At M6, persona history loading is a stub — the field is wired into AgentSpec
  // so the runtime can record persona attribution in events without injecting history.
  void spec.personaId; // consumed in M9 persona history injection

  // Defense-in-depth: dev-review keys must never reach a holdout. Strip from
  // both the allowlist and the context, emit a leak event per occurrence.
  // Runs BEFORE render so forbidden keys can't slip into the XML even if the
  // allowlist accidentally includes them.
  let effectiveContext = spec.context;
  let effectiveAllowlist = spec.contextAllowlist;
  const leaks = findHoldoutContextLeaks(spec);
  if (leaks.length > 0) {
    for (const leak of leaks) {
      eventStore.appendEvent({
        projectId: typeof spec.context.projectId === 'string' ? spec.context.projectId : 'unknown',
        workItemId:
          typeof spec.context.workItemId === 'string' ? spec.context.workItemId : undefined,
        kind: 'tool.violation',
        payload: {
          role: spec.role,
          runId: spec.runId,
          leak: 'dev-review',
          leakedKey: leak.key,
          source: leak.source,
        },
        runId: spec.runId,
      });
    }
    // Normalise to top-level when filtering — dotted entries like
    // `devReviewFindings.summary` would otherwise project the nested value.
    effectiveAllowlist = spec.contextAllowlist.filter(
      (k) => !HOLDOUT_FORBIDDEN_KEYS.has(topLevelKey(k)),
    );
    if (Object.keys(spec.context).some((k) => HOLDOUT_FORBIDDEN_KEYS.has(k))) {
      effectiveContext = Object.fromEntries(
        Object.entries(spec.context).filter(([k]) => !HOLDOUT_FORBIDDEN_KEYS.has(k)),
      );
    }
  }

  const { contextXml, disallowedKeys } = renderManifest(effectiveContext, effectiveAllowlist);

  // Emit tool.violation for disallowed keys on holdout roles
  if (HOLDOUT_ROLES.has(spec.role) && disallowedKeys.length > 0) {
    for (const key of disallowedKeys) {
      eventStore.appendEvent({
        projectId: typeof spec.context.projectId === 'string' ? spec.context.projectId : 'unknown',
        workItemId:
          typeof spec.context.workItemId === 'string' ? spec.context.workItemId : undefined,
        kind: 'tool.violation',
        payload: { role: spec.role, disallowedKey: key, runId: spec.runId },
        runId: spec.runId,
      });
    }
  }

  if (spec.freshContext) return { contextXml };
  // Non-fresh ambient injection (event stream, persona history) deferred to M9+
  return { contextXml };
}

function renderManifest(
  context: Record<string, unknown>,
  allowlist: string[],
): { contextXml: string; disallowedKeys: string[] } {
  const disallowedKeys: string[] = [];
  const filtered: Record<string, unknown> = {};

  if (allowlist.length === 0) {
    // empty allowlist = nothing passes; no user keys to flag as violations
    return { contextXml: '<task></task>', disallowedKeys };
  }

  // Partition allowlist into exact top-level keys vs dotted sub-key paths.
  const exactKeys = new Set<string>();
  const dottedSubKeys = new Map<string, Set<string>>();
  for (const entry of allowlist) {
    const dot = entry.indexOf('.');
    if (dot === -1) {
      exactKeys.add(entry);
    } else {
      const top = entry.slice(0, dot);
      const sub = entry.slice(dot + 1);
      let subs = dottedSubKeys.get(top);
      if (subs == null) {
        subs = new Set();
        dottedSubKeys.set(top, subs);
      }
      subs.add(sub);
    }
  }

  for (const [k, v] of Object.entries(context)) {
    if (exactKeys.has(k)) {
      filtered[k] = v;
    } else if (dottedSubKeys.has(k) && typeof v === 'object' && v !== null) {
      const subs = dottedSubKeys.get(k) as Set<string>;
      const projected: Record<string, unknown> = {};
      for (const sub of subs) {
        if (Object.prototype.hasOwnProperty.call(v, sub)) {
          projected[sub] = (v as Record<string, unknown>)[sub];
        }
      }
      filtered[k] = projected;
    } else if (!SYSTEM_KEYS.has(k)) {
      disallowedKeys.push(k);
    }
  }

  const inner = Object.entries(filtered)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const safe = escapeXml(typeof v === 'string' ? v : JSON.stringify(v));
      return `  <${k}>${safe}</${k}>`;
    })
    .join('\n');

  const contextXml = inner.length > 0 ? `<task>\n${inner}\n</task>` : '<task></task>';
  return { contextXml, disallowedKeys };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
