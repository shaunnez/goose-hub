import type { AgentSpec } from './interface.js';

export interface SpawnContext {
  contextXml: string;
}

/**
 * Centralised context injection point. All ambient injection routes through here.
 * When freshContext is true, only allowlist-filtered keys from spec.context are rendered —
 * no event-stream, persona history, or inbox injection. At M4, non-fresh path is identical.
 *
 * `spec.personaId` is accepted here and will be used to load persona history in M9+.
 * For now, the non-fresh path is a no-op stub.
 *
 * ESLint rule: any access to event-stream or persona-history from core/agent-runtime/
 * outside this file should be flagged (enforced manually until ESLint plugin is wired).
 */
export function assembleSpawnContext(spec: AgentSpec): SpawnContext {
  // personaId is available on spec for future M9 persona history injection.
  // At M6, persona history loading is a stub — the field is wired into AgentSpec
  // so the runtime can record persona attribution in events without injecting history.
  void spec.personaId; // consumed in M9 persona history injection
  const base = renderManifest(spec.context, spec.contextAllowlist);
  if (spec.freshContext) return base;
  // Non-fresh ambient injection (event stream, persona history) deferred to M9+
  return base;
}

function renderManifest(context: Record<string, unknown>, allowlist: string[]): SpawnContext {
  const filtered =
    allowlist.length === 0
      ? {}
      : Object.fromEntries(Object.entries(context).filter(([k]) => allowlist.includes(k)));

  const inner = Object.entries(filtered)
    .map(([k, v]) => {
      const safe = escapeXml(typeof v === 'string' ? v : JSON.stringify(v));
      return `  <${k}>${safe}</${k}>`;
    })
    .join('\n');

  const contextXml = inner.length > 0 ? `<task>\n${inner}\n</task>` : '<task></task>';
  return { contextXml };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
