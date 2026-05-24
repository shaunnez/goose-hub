/**
 * Parses test runner output into a compact failure summary the dev agent
 * can act on without scanning the raw blob. Vitest JSON reporter is the
 * primary path; a fallback heuristic catches plain-text runs.
 *
 * The summary intentionally caps failures and assertion messages so it
 * stays cheap to inject into the dev agent's next turn.
 */

export interface ParsedTestFailure {
  /** Fully qualified test name (suite + test). */
  testName: string;
  /** First assertion / error line from the failure. */
  assertion: string;
  /** Source file responsible for the test, if known. */
  file?: string;
  /** Optional line number parsed from the failure stack. */
  line?: number;
  /** Suggested category — coarse signal the dev agent can pivot on. */
  category: TestFailureCategory;
}

export type TestFailureCategory =
  | 'assertion'
  | 'timeout'
  | 'unhandled-error'
  | 'snapshot'
  | 'unknown';

export interface ParsedTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
}

export interface ParsedTestFailures {
  parserUsed: 'vitest-json' | 'vitest-text' | 'unknown';
  summary?: ParsedTestSummary;
  failures: ParsedTestFailure[];
  truncated: boolean;
}

const MAX_FAILURES = 5;
const MAX_ASSERTION_CHARS = 400;

/**
 * Top-level parser. Tries JSON first, falls back to text scanning when the
 * stdout doesn't look like Vitest JSON output (because the project is
 * configured for a different reporter, or the test command failed before
 * emitting JSON).
 */
export function parseTestFailures(input: {
  stdout: string;
  stderr: string;
}): ParsedTestFailures {
  const json = tryParseVitestJson(input.stdout);
  if (json != null) return json;

  const text = tryParseVitestText(`${input.stdout}\n${input.stderr}`);
  if (text != null) return text;

  return { parserUsed: 'unknown', failures: [], truncated: false };
}

function tryParseVitestJson(stdout: string): ParsedTestFailures | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  const candidate = locateJsonObject(trimmed);
  if (candidate == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.testResults)) return null;

  const failures: ParsedTestFailure[] = [];
  let truncated = false;

  for (const suite of record.testResults as Array<Record<string, unknown>>) {
    const filePath = typeof suite.name === 'string' ? suite.name : undefined;
    const assertions = Array.isArray(suite.assertionResults)
      ? (suite.assertionResults as Array<Record<string, unknown>>)
      : [];
    for (const assertion of assertions) {
      if (assertion.status !== 'failed') continue;
      if (failures.length >= MAX_FAILURES) {
        truncated = true;
        break;
      }
      const ancestors = Array.isArray(assertion.ancestorTitles)
        ? (assertion.ancestorTitles as unknown[]).filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [];
      const title = typeof assertion.title === 'string' ? assertion.title : '';
      const failureMessages = Array.isArray(assertion.failureMessages)
        ? (assertion.failureMessages as unknown[]).filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [];
      const rawMessage = failureMessages[0] ?? '';
      failures.push({
        testName: [...ancestors, title].filter((part) => part.length > 0).join(' > '),
        assertion: truncate(firstLine(rawMessage), MAX_ASSERTION_CHARS),
        file: filePath,
        line: extractLineNumber(rawMessage, filePath),
        category: categorize(rawMessage),
      });
    }
    if (failures.length >= MAX_FAILURES) break;
  }

  return {
    parserUsed: 'vitest-json',
    summary: extractJsonSummary(record),
    failures,
    truncated,
  };
}

function locateJsonObject(text: string): string | null {
  const first = text.indexOf('{');
  if (first < 0) return null;
  // Find the matching closing brace — handles preamble lines from npm
  // wrappers and trailing logs the reporter doesn't strip.
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = first; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === '\\') {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(first, i + 1);
    }
  }
  return null;
}

function extractJsonSummary(record: Record<string, unknown>): ParsedTestSummary | undefined {
  const total = numericField(record.numTotalTests);
  const passed = numericField(record.numPassedTests);
  const failed = numericField(record.numFailedTests);
  if (total == null && passed == null && failed == null) return undefined;
  return {
    total: total ?? 0,
    passed: passed ?? 0,
    failed: failed ?? 0,
    skipped: numericField(record.numPendingTests) ?? undefined,
  };
}

function numericField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

const STACK_LINE_RE = /\(?([^():\s]+\.(?:t|j)sx?):(\d+)(?::\d+)?\)?/;

function extractLineNumber(message: string, file?: string): number | undefined {
  if (file == null) return undefined;
  for (const line of message.split('\n')) {
    const match = STACK_LINE_RE.exec(line);
    if (match == null) continue;
    const [, matchedFile, rawLine] = match;
    if (file.endsWith(matchedFile) || matchedFile.endsWith(file)) {
      const parsed = Number.parseInt(rawLine, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function categorize(message: string): TestFailureCategory {
  const lower = message.toLowerCase();
  if (lower.includes('snapshot')) return 'snapshot';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('assertionerror') || lower.includes('expected')) return 'assertion';
  if (lower.includes('uncaught') || lower.includes('unhandled')) return 'unhandled-error';
  return 'unknown';
}

const TEXT_FAIL_RE = /^\s*FAIL\s+(?<file>[^\s]+)/i;
const TEXT_ARROW_RE = /^\s*[×✗]\s+(?<name>.+)$/;

function tryParseVitestText(text: string): ParsedTestFailures | null {
  if (text.trim().length === 0) return null;
  const lines = text.split('\n');
  const failures: ParsedTestFailure[] = [];
  let currentFile: string | undefined;
  let truncated = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const failMatch = TEXT_FAIL_RE.exec(line);
    if (failMatch != null) {
      currentFile = failMatch.groups?.file;
      continue;
    }
    const arrowMatch = TEXT_ARROW_RE.exec(rawLine);
    if (arrowMatch != null && currentFile != null) {
      if (failures.length >= MAX_FAILURES) {
        truncated = true;
        break;
      }
      const name = arrowMatch.groups?.name ?? '';
      failures.push({
        testName: name.trim(),
        assertion: truncate(name.trim(), MAX_ASSERTION_CHARS),
        file: currentFile,
        category: categorize(name),
      });
    }
  }

  if (failures.length === 0) return null;
  return { parserUsed: 'vitest-text', failures, truncated };
}
