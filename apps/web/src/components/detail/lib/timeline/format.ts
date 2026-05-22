export function formatSkillName(skill: string | null): string {
  if (skill == null) return '(Unknown)';
  if (skill === 'qa') return 'QA';
  return skill
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function getPayloadStr(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}
