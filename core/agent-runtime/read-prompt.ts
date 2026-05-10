import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REPO_ROOT = join(import.meta.dirname, '../..');

/**
 * Reads a skill's base prompt and optionally appends project-specific context.
 *
 * Looks for base prompt at: skills/<skillName>/prompt[.<variant>].md
 * Looks for project context at: target-projects/<projectSlug>/agent-context/<skillName>.md
 *
 * The optional repoRoot parameter exists for testing — production callers omit it.
 * Falls back to default prompt when the variant file is missing (warns, does not throw).
 */
export function readPromptWithContext(
  skillName: string,
  projectSlug: string,
  variant?: string,
  repoRoot: string = DEFAULT_REPO_ROOT,
): string {
  let basePrompt: string;
  if (variant) {
    const variantPath = join(repoRoot, 'skills', skillName, `prompt.${variant}.md`);
    if (existsSync(variantPath)) {
      basePrompt = readFileSync(variantPath, 'utf8');
    } else {
      console.warn(`[read-prompt] variant file not found: ${variantPath}, falling back to default`);
      basePrompt = readFileSync(join(repoRoot, 'skills', skillName, 'prompt.md'), 'utf8');
    }
  } else {
    basePrompt = readFileSync(join(repoRoot, 'skills', skillName, 'prompt.md'), 'utf8');
  }
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
