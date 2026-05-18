import type { ReactNode } from 'react';

// Splits `text` into segments where any token (case-insensitive) appears,
// wrapping matches in <mark>. Overlapping tokens get merged into the
// longest span so we never highlight the same character twice.

export function highlight(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0 || text.length === 0) return text;

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const t of tokens) {
    if (t.length === 0) continue;
    let from = 0;
    while (from <= lower.length - t.length) {
      const idx = lower.indexOf(t, from);
      if (idx < 0) break;
      ranges.push([idx, idx + t.length]);
      from = idx + t.length;
    }
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last != null && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark key={`${start}-${end}`} className="bg-accent-soft text-fg rounded-sm px-0.5">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2),
    ),
  );
}
