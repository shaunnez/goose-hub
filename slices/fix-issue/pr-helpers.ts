import { execFileSync } from 'node:child_process';
import { findFreePort } from '@goose-hub/core/agent-runtime/find-free-port.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { resolveBudgetsForProject } from '@goose-hub/core/agent-runtime/resolve-for-project.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { WorkItem } from '@goose-hub/core/state-source/interface.js';
import { EvidencePostSchema } from '@goose-hub/skills/evidence-post/schema.js';
import type { ImplementOutputShape } from './types.js';

export interface RunEvidencePostInput {
  workItem: WorkItem;
  projectId: string;
  runId: string;
  runtime: AgentRuntime;
  appendSystemPrompt: string;
  outputJsonSchema: Record<string, unknown>;
  prNumber: number;
  prHeadSha: string;
  repoRef: string;
  evidenceSpecPath: string | null;
  /**
   * Permalink to the BEFORE-state comment posted by playwright-repro during
   * investigation. Present only for type:bug; undefined for feature/chore.
   */
  beforeCommentUrl?: string;
  /**
   * Dev worktree path. Passed as `workspaceDir` so the agent runs inside the
   * git repo it must read from (spec source, app code) and push from. Without
   * this, the runtime falls back to a fresh empty directory and every git
   * command in the skill fails.
   */
  worktreePath: string;
}

/**
 * #234 wiring. Best-effort: failures emit `evidence.post-failed` and are
 * swallowed so the workflow can still transition to factory:approved.
 * If the developer skill did not declare an `evidenceSpecPath`, emit
 * `evidence.no-spec-declared` and skip.
 */
export async function runEvidencePost(input: RunEvidencePostInput): Promise<void> {
  if (input.evidenceSpecPath == null) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.no-spec-declared',
      payload: { runId: input.runId },
      runId: input.runId,
    });
    return;
  }

  const evidenceRunId = crypto.randomUUID();
  const projectConfig = await getProjectBySlug(input.projectId);
  const webPort = await findFreePort();
  try {
    const result = await input.runtime.run({
      runId: evidenceRunId,
      role: 'developer',
      skill: 'evidence-post',
      workspaceDir: input.worktreePath,
      context: {
        projectId: input.projectId,
        workItemId: input.workItem.id,
        workItem: {
          number: Number(input.workItem.externalId),
          repo: input.repoRef,
          title: input.workItem.title,
          beforeCommentUrl: input.beforeCommentUrl,
        },
        prNumber: input.prNumber,
        prHeadSha: input.prHeadSha,
        specPath: input.evidenceSpecPath,
      },
      contextAllowlist: [
        'workItem.number',
        'workItem.repo',
        'workItem.title',
        'workItem.beforeCommentUrl',
        'prNumber',
        'prHeadSha',
        'specPath',
      ],
      freshContext: false,
      toolBundles: ['validate'],
      toolExtras: [],
      env: {
        WEB_PORT: String(webPort),
        CI: 'true',
        EVIDENCE_ONLY: 'true',
      },
      ...resolveBudgetsForProject('evidence-post', projectConfig?.budgets, input.projectId),
      personaId: selectPersona(input.projectId, 'developer').personaId,
      outputJsonSchema: input.outputJsonSchema,
      appendSystemPrompt: input.appendSystemPrompt,
    });

    const parsed = EvidencePostSchema.safeParse(result.output);
    if (!parsed.success) {
      throw new Error('evidence-post output validation failed');
    }
    if (!parsed.data.commentUrl) {
      throw new Error('evidence-post returned no commentUrl — playwright run likely failed');
    }
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.posted',
      payload: { commentUrl: parsed.data.commentUrl, runId: evidenceRunId },
      runId: evidenceRunId,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItem.id,
      kind: 'evidence.post-failed',
      payload: { runId: evidenceRunId, error: error.message },
      runId: evidenceRunId,
    });
    // Swallow — best-effort.
  }
}

export function buildPrBody(opts: {
  workItem: WorkItem;
  implementOutput: ImplementOutputShape;
}): string {
  // Body intentionally contains NO implementation reasoning (FACTORY_RULES
  // rule 1 — QA / Reviewer holdouts read this on M8). Lists files written
  // and test files added; the work-item link plus `Closes #N` ties back
  // to the issue.
  const filesList = opts.implementOutput.filesWritten
    .map((f) => `- \`${f.path}\` — ${f.reason}`)
    .join('\n');
  const testsList = opts.implementOutput.testsWritten
    .map((t) => `- \`${t.path}\` (${t.cases} cases)`)
    .join('\n');

  return `## Summary

${opts.workItem.title}

## Files
${filesList || '_no files reported_'}

## Tests
${testsList || '_no tests reported_'}

Closes #${opts.workItem.externalId}
`;
}

/**
 * Resolves the worktree's current HEAD to a 40-char commit SHA so
 * evidence-post can pin raw.githubusercontent.com URLs to an immutable
 * ref (the #233 SHA-pinning contract). Falls back to `'HEAD'` only if
 * `git rev-parse` fails — the EvidencePostSchema requires `prHeadSha.length >= 7`,
 * which `'HEAD'` does NOT satisfy, so a fallback there will surface as
 * a schema validation error and be caught by runEvidencePost's
 * best-effort handler. That's intentional: a missing SHA is loud, not silent.
 *
 * Exported for test access — the chore-shipping path needs a real git repo
 * to exercise the rev-parse, and isolating the call here keeps the
 * workflow tests deps-injected for everything else.
 */
export function resolveWorktreeHeadSha(worktreePath: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktreePath,
      encoding: 'utf8',
    }).trim();
  } catch {
    // Triggers a schema validation failure inside runEvidencePost,
    // which emits evidence.post-failed and continues.
    return 'HEAD';
  }
}

export async function deriveStack(projectId: string): Promise<{
  testCommand: string;
  lintCommand?: string;
  typecheckCommand?: string;
}> {
  const config = await getProjectBySlug(projectId);
  if (config?.stack) {
    return {
      testCommand: config.stack.testCommand,
      lintCommand: config.stack.lintCommand,
      typecheckCommand: config.stack.typecheckCommand,
    };
  }
  return {
    testCommand: 'pnpm test',
    lintCommand: 'pnpm lint',
    typecheckCommand: 'pnpm typecheck',
  };
}
