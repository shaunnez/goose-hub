import type { AgentSpec } from './interface.js';

export interface SpawnContext {
  contextXml: string;
}

/**
 * Centralised context injection point. All ambient injection routes through here.
 * When freshContext is true, only allowlist-filtered keys from spec.context are rendered —
 * no event-stream, persona history, or inbox injection. At M4, non-fresh path is identical.
 *
 * ESLint rule: any access to event-stream or persona-history from core/agent-runtime/
 * outside this file should be flagged (enforced manually until ESLint plugin is wired).
 */
export function assembleSpawnContext(spec: AgentSpec): SpawnContext {
  const base = renderManifest(spec.context, spec.contextAllowlist);
  if (spec.freshContext) return base;
  // Non-fresh ambient injection (event stream, persona history) deferred to M5+
  return base;
}

function renderManifest(
  context: Record<string, unknown>,
  allowlist: string[],
): SpawnContext {
  const filtered = allowlist.length === 0
    ? {}
    : Object.fromEntries(
        Object.entries(context).filter(([k]) => allowlist.includes(k)),
      );

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
