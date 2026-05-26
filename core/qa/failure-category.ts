export const QA_FAILURE_CATEGORIES = [
  'spec-contract',
  'product',
  'regression-unrelated',
  'orchestration',
] as const;

export type QaFailureCategory = (typeof QA_FAILURE_CATEGORIES)[number];

export type QaTierName = 'structural' | 'functional' | 'regression';

export function classifyQaFailure(input: {
  failedTier?: 1 | 2 | 3 | QaTierName;
  hasActionableFinding?: boolean;
  hasFailedExecutableCheck?: boolean;
  orchestration?: boolean;
}): QaFailureCategory {
  if (input.orchestration === true) return 'orchestration';
  if (input.failedTier === 3 || input.failedTier === 'regression') return 'regression-unrelated';
  if (
    input.failedTier === 1 ||
    input.failedTier === 2 ||
    input.failedTier === 'structural' ||
    input.failedTier === 'functional' ||
    input.hasFailedExecutableCheck === true
  ) {
    return 'spec-contract';
  }
  if (input.hasActionableFinding === true) return 'product';
  return 'orchestration';
}
