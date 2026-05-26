/**
 * CLAUDE.md auditor — M12.02
 *
 * Given a repo path and detected stack info, this module:
 *  - Generates a CLAUDE.md template when none exists (action='create')
 *  - Produces a unified diff of missing sections when one exists but is
 *    incomplete (action='update')
 *  - Returns action='ok' when the existing file already contains all required
 *    sections
 *
 * NOTE: This module intentionally declares a local StackInfo type. The
 * canonical type will live in core/bootstrap/stack-detector.ts (M12.01),
 * which is being built in parallel. The bootstrap-project workflow (#307)
 * will reconcile the types.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal stack description needed by the auditor. */
export type StackInfo = {
  /** Primary language / framework identifier (e.g. 'node', 'python'). */
  type: string;
  /** Detected commands for common lifecycle operations. */
  commands?: {
    build?: string;
    test?: string;
    lint?: string;
    typecheck?: string;
    e2e?: string;
  };
};

/**
 * Result returned by `auditClaudeMd`.
 *
 *  - `action='create'` → `content` is the full CLAUDE.md template to write
 *  - `action='update'` → `content` is a unified diff of additions to append
 *  - `action='ok'`    → `content` is empty string; nothing to do
 */
export type AuditResult = {
  action: 'create' | 'update' | 'ok';
  /** New file content (create) or unified diff (update) or '' (ok). */
  content: string;
  /** Human-readable explanation of what was found and why. */
  rationale: string;
  /** Instruction file that was audited, or CLAUDE.md when a new file is proposed. */
  path?: string;
  /** Agent instruction files found in the repo root. */
  discoveredFiles?: string[];
};

export interface InstructionFileReader {
  exists(filePath: string): Promise<boolean>;
  readText(filePath: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Required section headings
// ---------------------------------------------------------------------------

/**
 * Canonical set of `## ` headings that every project CLAUDE.md should have.
 * Order matters for template generation.
 */
const REQUIRED_SECTIONS: ReadonlyArray<string> = [
  'What this repo is',
  'Stack',
  'Commands',
  'Hard rules',
  'PR conventions',
  // Holdout-safety boundary mandated by CONTEXT.md:275 — the workspace
  // CLAUDE.md is auto-loaded by Claude Code on every spawn, so it must be
  // holdout-clean by design. This section makes that boundary explicit.
  "What goes here / What doesn't",
] as const;

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

/**
 * Generates the full CLAUDE.md template text populated with discovered stack
 * commands.
 */
function generateTemplate(stackInfo: StackInfo): string {
  const cmds = stackInfo.commands ?? {};

  const commandLines: string[] = [];
  if (cmds.build) commandLines.push(`- build: \`${cmds.build}\``);
  if (cmds.test) commandLines.push(`- test: \`${cmds.test}\``);
  if (cmds.lint) commandLines.push(`- lint: \`${cmds.lint}\``);
  if (cmds.typecheck) commandLines.push(`- typecheck: \`${cmds.typecheck}\``);
  if (cmds.e2e) commandLines.push(`- e2e: \`${cmds.e2e}\``);

  const commandsBlock =
    commandLines.length > 0
      ? commandLines.join('\n')
      : '<!-- No commands detected. Fill in manually. -->';

  return `# CLAUDE.md

## What this repo is

<!-- TODO: Describe what this repository does and its primary purpose. -->

## Stack

- Language/framework: ${stackInfo.type}
<!-- TODO: List additional technologies used in this project. -->

## Commands

${commandsBlock}

## Hard rules

- Follow vertical slice architecture — no cross-slice imports.
- No inline prompts — all prompts live in \`skills/<name>/prompt.md\`.
- Every agent run must produce JSON conforming to its skill schema.
- State labels live on issues, not PRs.
- Do not modify governance files (MISSION.md, FACTORY_RULES.md, CLAUDE.md).

## PR conventions

- Title format: \`M<milestone>.<task>: <short description>\`
- Body must contain \`Closes #N\` on its own line.
- No implementation reasoning in the PR body.

## What goes here / What doesn't

This file is auto-loaded by Claude Code on every agent spawn, so it is
visible to QA and Reviewer holdouts. Keep it holdout-clean.

- Goes here: naming conventions, test/lint/build commands, repo layout, hard rules, PR conventions.
- Does not go here: implementation reasoning, plans, decision summaries, chat history, agent-specific guidance.

Per-skill guidance lives in \`skills/<name>/prompt.md\` or in \`AgentSpec.context\` filtered by allowlist — never in this file.
`;
}

// ---------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------

/** Extract the set of `## Heading` names present in a CLAUDE.md file. */
function extractSectionHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  for (const line of content.split('\n')) {
    const match = /^##\s+(.+)$/.exec(line.trim());
    if (match) {
      headings.add(match[1].trim());
    }
  }
  return headings;
}

// ---------------------------------------------------------------------------
// Diff generation
// ---------------------------------------------------------------------------

/**
 * Produces a minimal unified diff string that shows lines to be added for
 * each missing section. The format uses `+++`, `---`, and `@@` markers so it
 * is both human-readable and renderable in the UI / PR description.
 *
 * We only ever add lines (no deletions), so the `---` header references
 * the existing file and `+++` references the proposed augmented file.
 */
function buildAdditionDiff(
  existingContent: string,
  missingHeadings: string[],
  stackInfo: StackInfo,
): string {
  const cmds = stackInfo.commands ?? {};

  // Build per-section content blocks for each missing heading
  const sectionBlocks: Array<{ heading: string; lines: string[] }> = [];

  for (const heading of missingHeadings) {
    const lines: string[] = [`## ${heading}`, ''];

    switch (heading) {
      case 'What this repo is':
        lines.push(
          '<!-- TODO: Describe what this repository does and its primary purpose. -->',
          '',
        );
        break;

      case 'Stack':
        lines.push(
          `- Language/framework: ${stackInfo.type}`,
          '<!-- TODO: List additional technologies. -->',
          '',
        );
        break;

      case 'Commands': {
        const cmdLines: string[] = [];
        if (cmds.build) cmdLines.push(`- build: \`${cmds.build}\``);
        if (cmds.test) cmdLines.push(`- test: \`${cmds.test}\``);
        if (cmds.lint) cmdLines.push(`- lint: \`${cmds.lint}\``);
        if (cmds.typecheck) cmdLines.push(`- typecheck: \`${cmds.typecheck}\``);
        if (cmds.e2e) cmdLines.push(`- e2e: \`${cmds.e2e}\``);
        if (cmdLines.length === 0) {
          cmdLines.push('<!-- No commands detected. Fill in manually. -->');
        }
        lines.push(...cmdLines, '');
        break;
      }

      case 'Hard rules':
        lines.push(
          '- Follow vertical slice architecture — no cross-slice imports.',
          '- No inline prompts — all prompts live in `skills/<name>/prompt.md`.',
          '- Every agent run must produce JSON conforming to its skill schema.',
          '- State labels live on issues, not PRs.',
          '',
        );
        break;

      case 'PR conventions':
        lines.push(
          '- Title format: `M<milestone>.<task>: <short description>`',
          '- Body must contain `Closes #N` on its own line.',
          '- No implementation reasoning in the PR body.',
          '',
        );
        break;

      case "What goes here / What doesn't":
        lines.push(
          'This file is auto-loaded by Claude Code on every agent spawn, so it is',
          'visible to QA and Reviewer holdouts. Keep it holdout-clean.',
          '',
          '- Goes here: naming conventions, test/lint/build commands, repo layout, hard rules, PR conventions.',
          '- Does not go here: implementation reasoning, plans, decision summaries, chat history, agent-specific guidance.',
          '',
          'Per-skill guidance lives in `skills/<name>/prompt.md` or in `AgentSpec.context` filtered by allowlist — never in this file.',
          '',
        );
        break;

      default:
        lines.push('<!-- TODO: Fill in this section. -->', '');
        break;
    }

    sectionBlocks.push({ heading, lines });
  }

  // Count existing lines so we can set a realistic hunk offset
  const existingLineCount = existingContent.split('\n').length;

  // Build the unified diff output
  const diffParts: string[] = ['--- a/CLAUDE.md', '+++ b/CLAUDE.md'];

  let insertionOffset = existingLineCount + 1;

  for (const block of sectionBlocks) {
    const addedLines = block.lines;
    diffParts.push(`@@ -${insertionOffset},0 +${insertionOffset},${addedLines.length} @@`);
    for (const line of addedLines) {
      diffParts.push(`+${line}`);
    }
    insertionOffset += addedLines.length;
  }

  return `${diffParts.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audit the CLAUDE.md in `repoPath` against the detected `stackInfo`.
 *
 * Never writes to disk. Returns a result describing what action is needed and
 * the content (template or diff) that should be applied.
 */
export async function auditClaudeMd(repoPath: string, stackInfo: StackInfo): Promise<AuditResult> {
  return auditAgentInstructionsFromFiles(
    {
      exists: async (filePath) => {
        try {
          await fs.access(path.join(repoPath, filePath));
          return true;
        } catch {
          return false;
        }
      },
      readText: (filePath) => fs.readFile(path.join(repoPath, filePath), 'utf-8'),
    },
    stackInfo,
  );
}

export async function auditAgentInstructionsFromFiles(
  files: InstructionFileReader,
  stackInfo: StackInfo,
): Promise<AuditResult> {
  // ------------------------------------------------------------------
  // Case 1: no agent instruction file → generate a CLAUDE.md template
  // ------------------------------------------------------------------
  const discoveredFiles = await discoverInstructionFiles(files);
  const targetPath = await resolveInstructionPath(files, discoveredFiles);
  let existingContent: string | null = null;
  if (targetPath != null) {
    existingContent = await files.readText(targetPath);
  }

  if (existingContent === null) {
    const template = generateTemplate(stackInfo);
    return {
      action: 'create',
      content: template,
      rationale: 'No CLAUDE.md found. Generated a template populated with detected stack commands.',
      path: 'CLAUDE.md',
      discoveredFiles,
    };
  }

  // ------------------------------------------------------------------
  // Case 2: CLAUDE.md exists — check for missing sections
  // ------------------------------------------------------------------
  const presentHeadings = extractSectionHeadings(existingContent);
  const missingHeadings = REQUIRED_SECTIONS.filter((h) => !presentHeadings.has(h));

  if (missingHeadings.length === 0) {
    return {
      action: 'ok',
      content: '',
      rationale: `${targetPath} exists and contains all required sections. No changes needed.`,
      path: targetPath ?? 'CLAUDE.md',
      discoveredFiles,
    };
  }

  // ------------------------------------------------------------------
  // Case 3: some sections are missing → produce a unified diff
  // ------------------------------------------------------------------
  const diff = buildAdditionDiff(existingContent, missingHeadings, stackInfo);
  const missingList = missingHeadings.join(', ');

  return {
    action: 'update',
    content: diff,
    rationale: `${targetPath} exists but is missing required sections: ${missingList}. Diff shows additions only — existing content is preserved.`,
    path: targetPath ?? 'CLAUDE.md',
    discoveredFiles,
  };
}

const INSTRUCTION_FILE_CANDIDATES = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md'] as const;

async function discoverInstructionFiles(files: InstructionFileReader): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
    if (await files.exists(candidate)) found.push(candidate);
  }
  return found;
}

async function resolveInstructionPath(
  files: InstructionFileReader,
  discoveredFiles: string[],
): Promise<string | null> {
  if (discoveredFiles.length === 0) return null;

  const first = discoveredFiles[0];
  const firstContent = await files.readText(first);
  const delegated = delegatedClaudePath(firstContent);
  if (delegated != null && discoveredFiles.includes(delegated)) {
    return delegated;
  }
  return first;
}

function delegatedClaudePath(content: string): 'CLAUDE.md' | null {
  return /\bsee\s+CLAUDE\.md\b/i.test(content) || /\bCLAUDE\.md\b/i.test(content)
    ? 'CLAUDE.md'
    : null;
}
