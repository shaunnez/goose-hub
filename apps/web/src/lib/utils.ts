// apps/web/src/lib/utils.ts

// SQLite current_timestamp emits 'YYYY-MM-DD HH:MM:SS' without timezone — treat as UTC.
function parseUtc(iso: string): Date {
  const s = iso.includes('T') ? iso : iso.replace(' ', 'T');
  return new Date(s.endsWith('Z') || s.includes('+') ? s : `${s}Z`);
}

/** Full relative time string — e.g. "5m ago", "2h ago", "3d ago". */
export function timeAgo(iso: string): string {
  const ms = Date.now() - parseUtc(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Compact age label for kanban cards — e.g. "5m", "2h", "3d". */
export function ageLabel(createdAt: string): string {
  const created = parseUtc(createdAt).getTime();
  const now = Date.now();
  const minutes = Math.max(0, Math.floor((now - created) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Truncate a string to `max` chars, appending ellipsis if cut. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Formats a USD amount. When `label` is `'estimated'`, prefixes a tilde so the
 * user knows the figure is a Claude CLI rollup rather than authoritative API
 * metadata. See M9.09 for the labelling convention.
 */
export function formatCost(usd: number, label: 'estimated' | 'exact' = 'exact'): string {
  const abs = Math.abs(usd);
  const formatted = abs < 0.01 && abs > 0 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  return label === 'estimated' ? `~${formatted}` : formatted;
}

/** Formats large token counts as e.g. "1.2k", "464k", "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
