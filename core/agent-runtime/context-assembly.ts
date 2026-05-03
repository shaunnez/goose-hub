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
  const { contextXml, disallowedKeys } = renderManifest(spec.context, spec.contextAllowlist);

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
