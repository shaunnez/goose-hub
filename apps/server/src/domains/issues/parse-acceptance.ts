import { logger } from '@goose-hub/core/logger.js';

export interface VerifyBlock {
  ac: string;
  command: string;
  expected: string;
  tolerance: string;
}

const AC_LINE = /^\s*- \[[ xX]\] (.+)$/;

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

/**
 * Parses acceptance-criteria verify blocks from an issue body.
 *
 * Expected format per AC:
 *   - [ ] <AC text>
 *         Verify: <shell command>
 *         Expected: <expected output>
 *         Tolerance: <tolerance>
 *
 * ACs without all three fields are skipped (graceful degradation).
 */
export function parseAcceptanceCriteria(body: string): VerifyBlock[] {
  const lines = body.split('\n');
  const results: VerifyBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const match = AC_LINE.exec(lines[i]);
    if (!match) {
      i++;
      continue;
    }
    const ac = match[1].trim();

    // Collect lines belonging to this AC block (until the next AC line or blank-then-non-indented).
    const blockLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (AC_LINE.test(next)) break;
      blockLines.push(next);
      j++;
    }

    const command = extractField(blockLines, 'Verify:');
    const expected = extractField(blockLines, 'Expected:');
    const tolerance = extractField(blockLines, 'Tolerance:');

    if (command != null && expected != null && tolerance != null) {
      results.push({ ac, command, expected, tolerance });
    } else {
      logger.debug('ac.no-verify-block', { ac });
    }

    i = j;
  }

  return results;
}
