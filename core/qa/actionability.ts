export type QaDisposition = 'fixed' | 'needs-fix' | 'out-of-scope' | 'follow-up';

export interface QaCriteriaResultLike {
  criterionId: string;
  checkId: string;
  ac: string;
  command: string;
  expectedExitCodes?: number[];
  passed: boolean;
  exitCode?: number | null;
  actual?: string;
  error?: string;
}

export interface QaFindingLike {
  tier?: string;
  severity?: string;
  description: string;
  suggestion?: string;
  disposition?: QaDisposition;
  dispositionRef?: string;
}

export interface QaPayloadLike {
  criteriaResults?: QaCriteriaResultLike[];
  findings?: QaFindingLike[];
  tierResults?: Record<
    string,
    | {
        passed?: boolean;
        findings?: QaFindingLike[];
      }
    | undefined
  >;
}

export type ActionableQaItem =
  | {
      kind: 'criteria-result';
      summary: string;
      criteriaResult: QaCriteriaResultLike;
      reason: 'failed-executable-check';
    }
  | {
      kind: 'finding';
      summary: string;
      finding: QaFindingLike;
      reason: 'needs-fix' | 'unverified-follow-up' | 'undispositioned-error';
    };

export interface CollectActionableQaItemsOptions {
  verifiedFollowUpRefs?: ReadonlySet<string>;
}

function normalizedRef(ref: string | undefined): string | null {
  const trimmed = ref?.trim();
  if (trimmed == null || trimmed.length === 0) return null;
  const issueMatch = trimmed.match(/^#?(\d+)$/);
  if (issueMatch != null) return `#${issueMatch[1]}`;
  return trimmed;
}

function isVerifiedFollowUp(
  finding: QaFindingLike,
  verifiedFollowUpRefs: ReadonlySet<string>,
): boolean {
  const ref = normalizedRef(finding.dispositionRef);
  return ref != null && verifiedFollowUpRefs.has(ref);
}

function actionableFinding(
  finding: QaFindingLike,
  verifiedFollowUpRefs: ReadonlySet<string>,
): ActionableQaItem | null {
  if (finding.disposition === 'needs-fix') {
    return {
      kind: 'finding',
      summary: finding.description,
      finding,
      reason: 'needs-fix',
    };
  }
  if (finding.disposition === 'follow-up' && !isVerifiedFollowUp(finding, verifiedFollowUpRefs)) {
    return {
      kind: 'finding',
      summary: finding.description,
      finding,
      reason: 'unverified-follow-up',
    };
  }
  if (finding.severity === 'error' && finding.disposition == null) {
    return {
      kind: 'finding',
      summary: finding.description,
      finding,
      reason: 'undispositioned-error',
    };
  }
  return null;
}

export function collectActionableQaItems(
  payload: QaPayloadLike,
  options: CollectActionableQaItemsOptions = {},
): ActionableQaItem[] {
  const verifiedFollowUpRefs = options.verifiedFollowUpRefs ?? new Set<string>();
  const items: ActionableQaItem[] = [];

  for (const result of payload.criteriaResults ?? []) {
    if (result.passed) continue;
    items.push({
      kind: 'criteria-result',
      summary: `Executable check failed: ${result.ac} (${result.command})`,
      criteriaResult: result,
      reason: 'failed-executable-check',
    });
  }

  for (const finding of payload.findings ?? []) {
    const item = actionableFinding(finding, verifiedFollowUpRefs);
    if (item != null) items.push(item);
  }

  for (const result of Object.values(payload.tierResults ?? {})) {
    if (result == null || result.passed) continue;
    for (const finding of result.findings ?? []) {
      const item = actionableFinding(finding, verifiedFollowUpRefs);
      if (item != null) items.push(item);
    }
  }

  return items;
}

export function actionableQaItemsToFeedback(items: ActionableQaItem[]): string {
  if (items.length === 0) return '';
  const lines = ['QA actionable findings:', ''];
  for (const item of items) {
    if (item.kind === 'criteria-result') {
      lines.push(
        `- [executable-check] ${item.criteriaResult.ac}: ${item.criteriaResult.command} exited ${item.criteriaResult.exitCode ?? 'none'}`,
      );
      if (item.criteriaResult.error != null) lines.push(`  Error: ${item.criteriaResult.error}`);
      if (item.criteriaResult.actual != null && item.criteriaResult.actual.length > 0) {
        lines.push(`  Actual: ${item.criteriaResult.actual}`);
      }
      continue;
    }
    lines.push(
      `- [${item.finding.tier ?? 'qa'}/${item.finding.severity ?? 'unknown'}] ${item.finding.description}${item.finding.suggestion ? ` - ${item.finding.suggestion}` : ''}`,
    );
  }
  return lines.join('\n');
}
