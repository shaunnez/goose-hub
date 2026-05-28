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

function expectFactoryReadDiscipline(prompt: string): void {
  expect(prompt).toContain('Use `list_dir`, `list_files`, `search_text`, or `read_file`');
  expect(prompt).toContain('Do not use `resources/list`, `resources/read`, or file resources');
  expect(prompt).toContain('Do not assume Factory tools are unavailable');
  expect(prompt).toContain('If a required Factory tool call returns an error');
  expect(prompt).toContain('return explicit irrelevance');
  expect(prompt).toContain('If `<investigationSeed>` is empty and this scout is selected');
  expect(prompt).toContain('make at least one targeted Factory evidence call');
  expect(prompt).toContain('`status: "ok"` with `findings: []`');
}

describe('scout and Wave 2 prompt tool boundaries', () => {
  it.each(PROMPT_PATHS)('%s uses factory tools and forbids resource/delegation drift', (path) => {
    expectToolBoundary(readPrompt(path));
  });

  it.each(PROMPT_PATHS.filter((path) => path.startsWith('scout-')))(
    '%s tells scouts to use Factory read tools and avoid resource-failure reports',
    (path) => {
      expectFactoryReadDiscipline(readPrompt(path));
    },
  );
});
