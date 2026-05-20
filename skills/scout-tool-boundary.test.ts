import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PROMPT_PATHS = [
  'scout-code-path/prompt.md',
  'scout-dependency/prompt.md',
  'scout-pattern/prompt.md',
  'scout-schema/prompt.md',
  'scout-test-inventory/prompt.md',
  'scout-user-journey/prompt.md',
  'wave2-interface-designer/prompt.md',
  'wave2-risk-analyst/prompt.md',
];

function readPrompt(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function expectToolBoundary(prompt: string): void {
  expect(prompt).toContain('## Tool Boundary');
  expect(prompt).toContain('read_file');
  expect(prompt).toContain('search_text');
  expect(prompt).toContain('resources/read');
  expect(prompt).toMatch(/spawning/i);
  expect(prompt).toMatch(/delegation/i);
}

describe('scout and Wave 2 prompt tool boundaries', () => {
  it.each(PROMPT_PATHS)('%s uses factory tools and forbids resource/delegation drift', (path) => {
    expectToolBoundary(readPrompt(path));
  });
});
