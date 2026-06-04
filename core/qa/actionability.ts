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
  testRun?: {
    command?: string;
    status?: 'passed' | 'failed' | 'skipped' | string;
    failingSuites?: string[];
  };
  devTestsRun?: {
    command?: string;
    paths?: string[];
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
  | 'infrastructure-timeout'
  | 'attribution-unknown';

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
  issueSurfacePaths?: readonly string[];
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

  const issueSurfacePaths = collectIssueSurfacePaths(payload, verificationSummary, options);
  if ((payload.criteriaResults ?? []).some((result) => !result.passed)) {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'failed executable check is issue-local',
    };
  }
  if (
    verificationSummary.commands?.lint?.status === 'failed' ||
    verificationSummary.commands?.typecheck?.status === 'failed'
  ) {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'structural verification command failed',
    };
  }

  const testAttribution = classifyTestFailureAttribution(verificationSummary, issueSurfacePaths);
  if (testAttribution === 'issue-local') {
    return {
      classification: 'issue-local',
      actionable: true,
      reason: 'test failure intersects changed, owned, developer-test, or acceptance surface',
    };
  }

  const e2eCommand = verificationSummary.commands?.e2e?.command ?? verificationSummary.e2e?.command;
  const e2eStatus = verificationSummary.commands?.e2e?.status ?? verificationSummary.e2e?.status;
  if (e2eCommand == null || e2eStatus !== 'failed' || !isBroadE2eCommand(e2eCommand)) {
    if (testAttribution === 'outside-surface') {
      return {
        classification: 'regression-unrelated',
        actionable: false,
        reason:
          'broad test failure is outside changed, owned, developer-test, and acceptance surfaces',
      };
    }
    if (testAttribution === 'unknown') {
      return {
        classification: 'attribution-unknown',
        actionable: false,
        reason: 'test command failed but no failing suite could be attributed to this issue',
      };
    }
    return { classification: 'issue-local', actionable: true, reason: 'no broad e2e failure' };
  }

  const failureText = qaFailureText(payload, verificationSummary);
  if (mentionsRelatedSurface(failureText, issueSurfacePaths)) {
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

  const e2eSpecPaths = extractE2eSpecPaths(failureText);
  if (e2eSpecPaths.length > 0) {
    if (e2eSpecPaths.some((path) => isRelatedPath(path, issueSurfacePaths))) {
      return {
        classification: 'issue-local',
        actionable: true,
        reason: 'broad e2e failure names issue-local e2e surface',
      };
    }
    return {
      classification: 'regression-unrelated',
      actionable: false,
      reason: 'broad e2e failure is outside changed files and acceptance surface',
    };
  }

  if (testAttribution === 'outside-surface') {
    return {
      classification: 'regression-unrelated',
      actionable: false,
      reason:
        'broad test failure is outside changed, owned, developer-test, and acceptance surfaces',
    };
  }
  if (testAttribution === 'unknown') {
    return {
      classification: 'attribution-unknown',
      actionable: false,
      reason: 'test and e2e failed but neither failure could be attributed to this issue',
    };
  }

  return { classification: 'issue-local', actionable: true, reason: 'broad e2e failed' };
}

function collectIssueSurfacePaths(
  payload: QaPayloadLike,
  summary: QaVerificationSummaryLike,
  options: CollectActionableQaItemsOptions,
): string[] {
  return uniqueNormalizedPaths([
    ...(summary.changedFiles?.paths ?? []),
    ...(summary.devTestsRun?.paths ?? []),
    ...(options.issueSurfacePaths ?? []),
    ...(payload.criteriaResults ?? []).flatMap((result) =>
      extractPathsFromText([result.ac, result.command, result.actual, result.error].join('\n')),
    ),
  ]);
}

type TestFailureAttribution = 'none' | 'issue-local' | 'outside-surface' | 'unknown';

function classifyTestFailureAttribution(
  summary: QaVerificationSummaryLike,
  issueSurfacePaths: readonly string[],
): TestFailureAttribution {
  const test = summary.commands?.test;
  if (test?.status !== 'failed') return 'none';
  const command = test.command ?? summary.testRun?.command ?? '';
  if (!isBroadTestCommand(command)) return 'issue-local';

  const testText = [
    test.command,
    test.error,
    test.stdout,
    test.stderr,
    summary.testRun?.command,
    ...(summary.testRun?.failingSuites ?? []),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  if (mentionsRelatedSurface(testText, issueSurfacePaths)) return 'issue-local';

  const failedPaths = uniqueNormalizedPaths([
    ...(summary.testRun?.failingSuites ?? []),
    ...extractPathsFromText(testText),
  ]);
  if (failedPaths.length === 0) return 'unknown';
  return failedPaths.some((path) => isRelatedPath(path, issueSurfacePaths))
    ? 'issue-local'
    : 'outside-surface';
}

function isBroadTestCommand(command: string): boolean {
  if (command.trim().length === 0) return true;
  return extractPathsFromText(command).length === 0;
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

function qaFailureText(payload: QaPayloadLike, summary: QaVerificationSummaryLike): string {
  const parts: string[] = [];
  const e2e = summary.commands?.e2e;
  for (const value of [e2e?.command, e2e?.error, e2e?.stdout, e2e?.stderr]) {
    if (typeof value === 'string') parts.push(value);
  }
  for (const result of payload.criteriaResults ?? []) {
    parts.push(result.ac, result.command);
    if (result.actual != null) parts.push(result.actual);
    if (result.error != null) parts.push(result.error);
  }
  return parts.join('\n');
}

function mentionsRelatedSurface(text: string, relatedPaths: readonly string[]): boolean {
  const normalizedText = text.toLowerCase();
  for (const path of relatedPaths) {
    const normalizedPath = path.toLowerCase();
    if (normalizedPath.length > 0 && normalizedText.includes(normalizedPath)) return true;
    const fileName = normalizedPath.split('/').pop();
    if (fileName == null || fileName.length === 0) continue;
    const stem = fileName.replace(/\.[^.]+$/, '');
    if (stem.length >= 4 && normalizedText.includes(stem)) return true;
  }
  return false;
}

function extractE2eSpecPaths(text: string): string[] {
  return extractPathsFromText(text).filter((path) => path.startsWith('apps/web/e2e/'));
}

function extractPathsFromText(text: string): string[] {
  const matches = text.matchAll(
    /\b((?:apps|core|slices|skills|packages|src)\/[^\s:)'",]+?\.[cm]?[jt]sx?)\b/g,
  );
  return uniqueNormalizedPaths([...matches].map((match) => match[1] ?? ''));
}

function normalizePath(path: string): string {
  return path
    .replace(/^\.?\//, '')
    .replace(/\\/g, '/')
    .trim();
}

function uniqueNormalizedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter((path) => path.length > 0))];
}

function pathWithoutTestSuffix(path: string): string {
  return normalizePath(path)
    .replace(/\.(test|spec)\.[cm]?[jt]sx?$/, '')
    .replace(/\.[cm]?[jt]sx?$/, '');
}

function isRelatedPath(path: string, relatedPaths: readonly string[]): boolean {
  const normalizedPath = normalizePath(path);
  const pathBase = pathWithoutTestSuffix(normalizedPath);
  if (pathBase.length === 0) return false;
  return relatedPaths.some((relatedPath) => {
    const related = normalizePath(relatedPath);
    const relatedBase = pathWithoutTestSuffix(related);
    return (
      normalizedPath === related ||
      pathBase === relatedBase ||
      normalizedPath.includes(relatedBase) ||
      related.includes(pathBase)
    );
  });
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
