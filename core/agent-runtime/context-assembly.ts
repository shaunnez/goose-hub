import { eventStore } from '../event-stream/store.js';
import { renderContext } from './context-renderer.js';
import {
  HOLDOUT_FORBIDDEN_KEYS,
  findDisallowedKeys,
  findHoldoutContextLeaks,
} from './holdout-validator.js';
import type { AgentSpec } from './interface.js';

// Re-export for callers that import these from context-assembly
export type { HoldoutContextLeak } from './holdout-validator.js';
export { HOLDOUT_FORBIDDEN_KEYS, findHoldoutContextLeaks } from './holdout-validator.js';

export interface SpawnContext {
  contextXml: string;
}

// Holdout roles that enforce strict context isolation (kept here for violation event emission)
const HOLDOUT_ROLES = new Set(['qa', 'reviewer']);

/**
 * Derives the effective allowlist for a spec, stripping forbidden dev-review
 * keys when leaks have been detected.
 */
function effectiveAllowlist(spec: AgentSpec, leaks: ReturnType<typeof findHoldoutContextLeaks>) {
  if (leaks.length === 0) return spec.contextAllowlist;
  return spec.contextAllowlist.filter((k) => {
    const dot = k.indexOf('.');
    const top = dot === -1 ? k : k.slice(0, dot);
    return !HOLDOUT_FORBIDDEN_KEYS.has(top);
  });
}

/**
 * Derives the effective context for a spec, stripping forbidden dev-review
 * keys when leaks have been detected.
 */
function effectiveContext(
  spec: AgentSpec,
  leaks: ReturnType<typeof findHoldoutContextLeaks>,
): Record<string, unknown> {
  if (leaks.length === 0) return spec.context;
  if (!Object.keys(spec.context).some((k) => HOLDOUT_FORBIDDEN_KEYS.has(k))) return spec.context;
  return Object.fromEntries(
    Object.entries(spec.context).filter(([k]) => !HOLDOUT_FORBIDDEN_KEYS.has(k)),
  );
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
  }

  const filteredContext = effectiveContext(spec, leaks);
  const filteredAllowlist = effectiveAllowlist(spec, leaks);

  // Emit tool.violation for disallowed keys on holdout roles
  if (HOLDOUT_ROLES.has(spec.role)) {
    const disallowedKeys = findDisallowedKeys(filteredContext, filteredAllowlist);
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

  const contextXml = renderContext(filteredContext, filteredAllowlist);

  if (spec.freshContext) return { contextXml };
  // Non-fresh ambient injection (event stream, persona history) deferred to M9+
  return { contextXml };
}
