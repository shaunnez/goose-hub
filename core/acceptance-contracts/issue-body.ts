import type { AcceptanceCriterionContract, VerifyCommandContract } from './types.js';

const AC_LINE = /^\s*- \[[ xX]\]\s+(.+)$/;

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

    const verifyCommand = extractField(blockLines, 'Verify:');
    const expected = extractField(blockLines, 'Expected:');
    const tolerance = extractField(blockLines, 'Tolerance:');
    const criterion: AcceptanceCriterionContract = {
      id: `AC-${results.length + 1}`,
      statement,
      sourceRef: 'workItem.body',
    };
    if (verifyCommand != null) criterion.verifyCommand = verifyCommand;
    if (expected != null) criterion.expected = expected;
    if (tolerance != null) criterion.tolerance = tolerance;
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
  return criteria.flatMap((criterion) => {
    if (
      criterion.verifyCommand == null ||
      criterion.expected == null ||
      criterion.tolerance == null
    ) {
      return [];
    }
    return [
      {
        ac: criterion.statement,
        command: criterion.verifyCommand,
        expected: criterion.expected,
        tolerance: criterion.tolerance,
      },
    ];
  });
}
