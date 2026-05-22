import type { AcceptanceCriterionContract, VerifyCommandContract } from './types.js';

const AC_LINE = /^\s*- \[[ xX]\]\s+(.+)$/;
const EXECUTABLE_CHECK_LABEL = /^\s*Executable check:\s*$/i;
const COMMAND_FIELD = /^\s*-\s*Command:\s*(.+)\s*$/i;
const EXPECTED_EXIT_CODES_FIELD = /^\s*-\s*Expected exit codes:\s*(.+)\s*$/i;
const KIND_FIELD = /^\s*-\s*Kind:\s*(.+)\s*$/i;
const TIMEOUT_MS_FIELD = /^\s*-\s*Timeout ms:\s*(.+)\s*$/i;
const OUTPUT_EXPECTATION_FIELD =
  /^\s*-\s*Output expectation:\s*(exact|contains|regex)\s*:\s*(.+)\s*$/i;

function extractField(lines: string[], prefix: string): string | undefined {
  const lower = prefix.toLowerCase();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(lower)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return undefined;
}

function parseExpectedExitCodes(value: string | undefined): number[] | undefined {
  if (value == null) return undefined;
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return undefined;
  const parsed = parts.map((part) => Number(part));
  if (parsed.some((n) => !Number.isInteger(n))) return undefined;
  return parsed;
}

function parseExecutableCheckBlocks(
  lines: string[],
  criterionId: string,
): AcceptanceCriterionContract['executableChecks'] {
  const checks: NonNullable<AcceptanceCriterionContract['executableChecks']> = [];
  let i = 0;
  while (i < lines.length) {
    if (!EXECUTABLE_CHECK_LABEL.test(lines[i])) {
      i++;
      continue;
    }

    const block: string[] = [];
    let j = i + 1;
    while (j < lines.length && !EXECUTABLE_CHECK_LABEL.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }

    const command = block.flatMap((line) => {
      const match = COMMAND_FIELD.exec(line);
      return match?.[1] != null && match[1].trim().length > 0 ? [match[1].trim()] : [];
    })[0];
    if (command != null) {
      const expectedExitCodesRaw = block.flatMap((line) => {
        const match = EXPECTED_EXIT_CODES_FIELD.exec(line);
        return match?.[1] != null ? [match[1]] : [];
      })[0];
      const expectedExitCodes = parseExpectedExitCodes(expectedExitCodesRaw);
      if (expectedExitCodesRaw != null && expectedExitCodes == null) {
        i = j;
        continue;
      }
      const kind = block.flatMap((line) => {
        const match = KIND_FIELD.exec(line);
        const value = match?.[1]?.trim();
        return value != null && value.length > 0 ? [value] : [];
      })[0];
      const timeoutMs = block.flatMap((line) => {
        const match = TIMEOUT_MS_FIELD.exec(line);
        const value = Number(match?.[1]?.trim());
        return Number.isInteger(value) && value > 0 ? [value] : [];
      })[0];
      const outputExpectation = block.flatMap((line) => {
        const match = OUTPUT_EXPECTATION_FIELD.exec(line);
        return match?.[1] != null && match[2] != null
          ? [{ mode: match[1] as 'exact' | 'contains' | 'regex', value: match[2].trim() }]
          : [];
      })[0];
      checks.push({
        id: `${criterionId}-check-${checks.length + 1}`,
        command,
        ...(expectedExitCodes != null ? { expectedExitCodes } : {}),
        ...(outputExpectation != null ? { outputExpectation } : {}),
        ...(timeoutMs != null ? { timeoutMs } : {}),
        ...(kind === 'unit' ||
        kind === 'integration' ||
        kind === 'e2e' ||
        kind === 'api' ||
        kind === 'lint' ||
        kind === 'typecheck' ||
        kind === 'custom'
          ? { kind }
          : {}),
      });
    }

    i = j;
  }
  return checks.length > 0 ? checks : undefined;
}

function legacyVerifyBlockToExecutableCheck(
  lines: string[],
  criterionId: string,
): AcceptanceCriterionContract['executableChecks'] {
  const verifyCommand = extractField(lines, 'Verify:');
  if (verifyCommand == null) return undefined;
  const expected = extractField(lines, 'Expected:');
  const tolerance = extractField(lines, 'Tolerance:');
  const mode =
    tolerance === 'exact' || tolerance === 'contains' || tolerance === 'regex'
      ? tolerance
      : undefined;
  return [
    {
      id: `${criterionId}-check-1`,
      command: verifyCommand,
      ...(expected != null && mode != null ? { outputExpectation: { mode, value: expected } } : {}),
    },
  ];
}

export function parseIssueBodyAcceptanceCriteria(body: string): AcceptanceCriterionContract[] {
  const lines = body.split('\n');
  const results: AcceptanceCriterionContract[] = [];

  let i = 0;
  while (i < lines.length) {
    const match = AC_LINE.exec(lines[i]);
    if (match == null) {
      i++;
      continue;
    }

    const statement = match[1].trim();
    const blockLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (AC_LINE.test(next)) break;
      blockLines.push(next);
      j++;
    }

    const id = `AC-${results.length + 1}`;
    const executableChecks =
      parseExecutableCheckBlocks(blockLines, id) ??
      legacyVerifyBlockToExecutableCheck(blockLines, id);
    const criterion: AcceptanceCriterionContract = {
      id,
      statement,
      sourceRef: 'workItem.body',
    };
    if (executableChecks != null) criterion.executableChecks = executableChecks;
    results.push(criterion);
    i = j;
  }

  return results;
}

export function parseIssueBodyVerifyCommands(body: string): VerifyCommandContract[] {
  return acceptanceCriteriaToVerifyCommands(parseIssueBodyAcceptanceCriteria(body));
}

export function acceptanceCriteriaToVerifyCommands(
  criteria: AcceptanceCriterionContract[],
): VerifyCommandContract[] {
  return criteria.flatMap((criterion) =>
    (criterion.executableChecks ?? []).map((check) => ({
      criterionId: criterion.id,
      checkId: check.id,
      ac: criterion.statement,
      command: check.command,
      expectedExitCodes: check.expectedExitCodes ?? [0],
      ...(check.outputExpectation != null ? { outputExpectation: check.outputExpectation } : {}),
      ...(check.timeoutMs != null ? { timeoutMs: check.timeoutMs } : {}),
    })),
  );
}
