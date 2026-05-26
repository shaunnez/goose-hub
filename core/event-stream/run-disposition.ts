export const RUN_DISPOSITIONS = [
  'completed',
  'budget-killed',
  'persistence-failed',
  'blocked-gate',
] as const;

export type RunDisposition = (typeof RUN_DISPOSITIONS)[number];

export function isRunDisposition(value: unknown): value is RunDisposition {
  return typeof value === 'string' && RUN_DISPOSITIONS.includes(value as RunDisposition);
}
