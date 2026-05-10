/**
 * Pure XML rendering layer for agent context.
 *
 * No governance knowledge — takes pre-filtered context and a pre-scrubbed
 * allowlist from the caller. Returns contextXml only.
 */

/**
 * Render `context` keys permitted by `allowlist` into an XML `<task>` block.
 *
 * Supports dotted-path sub-key projection (e.g. `workItem.title`) in addition
 * to exact top-level key inclusion.
 *
 * Returns `<task></task>` when the allowlist is empty or all values are
 * undefined.
 */
export function renderContext(context: Record<string, unknown>, allowlist: string[]): string {
  if (allowlist.length === 0) {
    return '<task></task>';
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

  const filtered: Record<string, unknown> = {};
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
    }
    // Keys not in allowlist are silently omitted — governance (disallowed key
    // detection + violation events) is the caller's responsibility.
  }

  const inner = Object.entries(filtered)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const safe = escapeXml(typeof v === 'string' ? v : JSON.stringify(v));
      return `  <${k}>${safe}</${k}>`;
    })
    .join('\n');

  return inner.length > 0 ? `<task>\n${inner}\n</task>` : '<task></task>';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
