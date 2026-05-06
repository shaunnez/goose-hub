import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readPromptWithContext } from './read-prompt.js';

const root = join(tmpdir(), `read-prompt-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(join(root, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(root, 'skills', 'my-skill', 'prompt.md'), '# base prompt');

  mkdirSync(join(root, 'target-projects', 'my-project', 'agent-context'), { recursive: true });
  writeFileSync(
    join(root, 'target-projects', 'my-project', 'agent-context', 'my-skill.md'),
    '## project context',
  );
});

describe('readPromptWithContext', () => {
  it('returns base prompt when no project context exists', () => {
    const result = readPromptWithContext('my-skill', 'no-such-project', root);
    expect(result).toBe('# base prompt');
  });

  it('appends project context when agent-context file exists', () => {
    const result = readPromptWithContext('my-skill', 'my-project', root);
    expect(result).toContain('# base prompt');
    expect(result).toContain('## project context');
    expect(result.indexOf('# base prompt')).toBeLessThan(result.indexOf('## project context'));
  });

  it('separates base and project context with double newline + header', () => {
    const result = readPromptWithContext('my-skill', 'my-project', root);
    expect(result).toContain('\n\n## Project-specific context\n\n');
  });
});
