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

export interface QaCommandSummaryLike {
  command?: string;
  status?: 'passed' | 'failed' | 'skipped' | string;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface QaVerificationSummaryLike {
  changedFiles?: {
    paths?: string[];
  };
  commands?: {
    lint?: QaCommandSummaryLike;
    typecheck?: QaCommandSummaryLike;
    test?: QaCommandSummaryLike;
    e2e?: QaCommandSummaryLike;
  };
  e2e?: {
    mode?: string;
    command?: string;
    status?: 'passed' | 'failed' | 'skipped' | string;
    reason?: string;
  };
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
  verificationSummary?: QaVerificationSummaryLike;
  tierResults?: Record<
    string,
    | {
        passed?: boolean;
        findings?: QaFindingLike[];
      }
    | undefined
  >;
}

export type QaRepairClassification =
  | 'issue-local'
  | 'regression-unrelated'
  | 'infrastructure-timeout';

export interface QaFailureActionability {
  classification: QaRepairClassification;
  actionable: boolean;
  reason: string;
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
  verificationSummary?: QaVerificationSummaryLike;
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
  const actionability = classifyQaFailureActionability(payload, options);
  if (!actionability.actionable) return [];

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

export function classifyQaFailureActionability(
  payload: QaPayloadLike,
  options: CollectActionableQaItemsOptions = {},
): QaFailureActionability {
  const verificationSummary = options.verificationSummary ?? payload.verificationSummary;
  if (verificationSummary == null) {
    return { classification: 'issue-local', actionable: true, reason: 'no verification summary' };
  }

  const e2eCommand = verificationSummary.commands?.e2e?.command ?? verificationSummary.e2e?.command;
  const e2eStatus = verificationSummary.commands?.e2e?.status ?? verificationSummary.e2e?.status;
  if (e2eCommand == null || e2eStatus !== 'failed' || !isBroadE2eCommand(e2eCommand)) {
    return { classification: 'issue-local', actionable: true, reason: 'no broad e2e failure' };
  }
  if ((payload.criteriaResults ?? []).some((result) => !result.passed)) {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'failed executable check is issue-local',
    };
  }
  if (
    verificationSummary.commands?.lint?.status === 'failed' ||
    verificationSummary.commands?.typecheck?.status === 'failed' ||
    verificationSummary.commands?.test?.status === 'failed'
  ) {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'focused verification command failed',
    };
  }

  const failureText = qaFailureText(payload, verificationSummary);
  if (mentionsChangedSurface(failureText, verificationSummary.changedFiles?.paths ?? [])) {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'broad e2e failure names changed surface',
    };
  }

  if (isTimeoutFailureText(failureText)) {
    return {
      classification: 'infrastructure-timeout',
      actionable: false,
      reason: 'broad e2e timed out without changed-surface evidence',
    };
  }

  if (mentionsE2eSpec(failureText)) {
    return {
      classification: 'regression-unrelated',
      actionable: false,
      reason: 'broad e2e failure is outside changed files and acceptance surface',
    };
  }

  return { classification: 'issue-local', actionable: true, reason: 'broad e2e failed' };
}

function isBroadE2eCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    normalized.includes('test:e2e:pipeline') ||
    normalized.includes('test:e2e') ||
    normalized.includes('playwright test')
  );
}

function isTimeoutFailureText(text: string): boolean {
  return /\b(timeout|timed out)\b/i.test(text);
}

function mentionsE2eSpec(text: string): boolean {
  return /(?:^|\s)apps\/web\/e2e\/[^:\s]+\.spec\.ts/i.test(text);
}

function qaFailureText(payload: QaPayloadLike, summary: QaVerificationSummaryLike): string {
  const parts: string[] = [];
  const e2e = summary.commands?.e2e;
  for (const value of [e2e?.command, e2e?.error, e2e?.stdout, e2e?.stderr, summary.e2e?.reason]) {
    if (typeof value === 'string') parts.push(value);
  }
  for (const result of payload.criteriaResults ?? []) {
    parts.push(result.ac, result.command);
    if (result.actual != null) parts.push(result.actual);
    if (result.error != null) parts.push(result.error);
  }
  for (const finding of payload.findings ?? []) {
    parts.push(finding.description);
    if (finding.suggestion != null) parts.push(finding.suggestion);
  }
  for (const result of Object.values(payload.tierResults ?? {})) {
    for (const finding of result?.findings ?? []) {
      parts.push(finding.description);
      if (finding.suggestion != null) parts.push(finding.suggestion);
    }
  }
  return parts.join('\n');
}

function mentionsChangedSurface(text: string, changedPaths: readonly string[]): boolean {
  const normalizedText = text.toLowerCase();
  for (const path of changedPaths) {
    const normalizedPath = path.toLowerCase();
    if (normalizedPath.length > 0 && normalizedText.includes(normalizedPath)) return true;
    const fileName = normalizedPath.split('/').pop();
    if (fileName == null || fileName.length === 0) continue;
    const stem = fileName.replace(/\.[^.]+$/, '');
    if (stem.length >= 4 && normalizedText.includes(stem)) return true;
  }
  return false;
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
