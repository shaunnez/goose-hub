import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REPO_ROOT = join(import.meta.dirname, '../..');

/**
 * Reads a skill's base prompt and optionally appends project-specific context.
 *
 * Looks for base prompt at: skills/<skillName>/skill.md
 * Looks for project context at: target-projects/<projectSlug>/agent-context/<skillName>.md
 *
 * The optional repoRoot parameter exists for testing — production callers omit it.
 */
export function readPromptWithContext(
  skillName: string,
  projectSlug: string,
  repoRoot: string = DEFAULT_REPO_ROOT,
): string {
  const basePrompt = readFileSync(join(repoRoot, 'skills', skillName, 'skill.md'), 'utf8');
  const contextPath = join(
    repoRoot,
    'target-projects',
    projectSlug,
    'agent-context',
    `${skillName}.md`,
  );
  if (!existsSync(contextPath)) return basePrompt;
  const projectContext = readFileSync(contextPath, 'utf8');
  return `${basePrompt}\n\n## Project-specific context\n\n${projectContext}`;
}
