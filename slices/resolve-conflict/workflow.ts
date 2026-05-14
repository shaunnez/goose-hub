import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildAgentComment } from '@goose-hub/core/agent-comment/index.js';
import type { AgentRuntime } from '@goose-hub/core/agent-runtime/interface.js';
import { readPromptWithContext } from '@goose-hub/core/agent-runtime/read-prompt.js';
import { resolveProjectAgentExecution } from '@goose-hub/core/agent-runtime/resolve-runtime-for-project.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import {
  type MergePrInput,
  mergePR as defaultMergePR,
} from '@goose-hub/core/connectors/github/merge-pr.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { getProjectBySlug } from '@goose-hub/core/projects/loader.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { ResolveConflictSchema } from '@goose-hub/skills/resolve-conflict/schema.js';
import config from '@goose-hub/skills/resolve-conflict/skill.config.js';

const WORKSPACES_DIR = join(homedir(), '.factory', 'workspaces');

const CONFLICT_MARKER_RE = /^(<{7}|={7}|>{7})/m;

type GitExec = (args: string[], cwd: string) => string;

function defaultGitExec(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

export interface ResolveConflictDeps {
  runtime?: AgentRuntime;
  mergePRImpl?: (input: MergePrInput) => Promise<{ sha: string; merged: boolean }>;
  gitExecImpl?: GitExec;
}

/**
 * Runs the merge-conflict resolution workflow for a work item in
 * `factory:merge-conflict` state. See `slices/resolve-conflict/README.md`
 * for the state-machine diagram and failure modes.
 */
export async function runResolveConflictWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  slug: string,
  repoRoot: string,
  deps: ResolveConflictDeps = {},
): Promise<void> {
  const {
    runtime: runtimeOverride,
    mergePRImpl = defaultMergePR,
    gitExecImpl = defaultGitExec,
  } = deps;

  const workItemId = workItem.id;
  const issueNumber = workItem.externalId;
  const repoRef = workItem.repoRef ?? slug;

  // Find most recent pr.opened event so we know which branch / PR to recover.
  const events = eventStore.replay({ workItemId });
  const prEvent = [...events].reverse().find((e) => e.kind === 'pr.opened');
  if (prEvent == null) {
    await stateSource.transitionState(issueNumber, 'factory:merge-conflict', 'factory:needs-human');
    await stateSource.comment(
      issueNumber,
      buildAgentComment(
        'Resolve-Conflict',
        'Failed',
        'No pr.opened event found — escalating to needs-human',
      ),
    );
    return;
  }

  const {
    branch,
    baseBranch = 'main',
    prNumber,
    prUrl,
  } = prEvent.payload as {
    branch: string;
    baseBranch?: string;
    prNumber: number;
    prUrl: string;
  };

  const runId = crypto.randomUUID();
  const wtPath = join(WORKSPACES_DIR, runId);
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  const projectConfig = await getProjectBySlug(slug);

  try {
    // Worktree on the PR branch (committable, not detached).
    gitExecImpl(['worktree', 'add', wtPath, branch], repoRoot);

    gitExecImpl(['fetch', 'origin'], wtPath);

    let hasMergeConflicts = false;
    try {
      gitExecImpl(['merge', `origin/${baseBranch}`], wtPath);
    } catch {
      hasMergeConflicts = true;
    }

    if (hasMergeConflicts) {
      const conflictedOutput = gitExecImpl(['diff', '--name-only', '--diff-filter=U'], wtPath);
      const conflictedFiles = conflictedOutput
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      if (conflictedFiles.length > 0) {
        const { personaId } = selectPersona(slug, 'developer');
        const { runtime, resolvedBudget } = resolveProjectAgentExecution({
          skill: 'resolve-conflict',
          role: 'developer',
          projectId: slug,
          projectConfig,
          injectedRuntime: runtimeOverride,
        });

        const agentResult = await runtime.run({
          runId,
          role: 'developer',
          skill: 'resolve-conflict',
          context: {
            worktreePath: wtPath,
            conflictedFiles,
            baseBranch,
            prNumber,
          },
          contextAllowlist: config.contextAllowlist ?? [],
          freshContext: false,
          toolBundles: config.toolBundles,
          toolExtras: [],
          ...resolvedBudget,
          personaId,
          outputJsonSchema: toJsonSchema(ResolveConflictSchema),
          appendSystemPrompt: readPromptWithContext('resolve-conflict', slug),
          workspaceDir: wtPath,
        });

        const parsed = ResolveConflictSchema.safeParse(agentResult.output);
        if (!parsed.success) {
          throw new Error('Agent output failed schema validation');
        }
        if (parsed.data.unresolvable.length > 0) {
          throw new Error(`Agent could not resolve: ${parsed.data.unresolvable.join(', ')}`);
        }
        if (parsed.data.confidence === 'low') {
          throw new Error('Agent reported low confidence in conflict resolution');
        }

        // Defensive: re-scan every file the agent claimed to resolve. If any
        // still contain conflict markers, the agent's self-report is wrong —
        // escalate rather than commit broken code.
        for (const f of parsed.data.resolved) {
          const content = readFileSync(join(wtPath, f), 'utf8');
          if (CONFLICT_MARKER_RE.test(content)) {
            throw new Error(`Resolved file ${f} still contains conflict markers`);
          }
        }

        gitExecImpl(['add', '-A'], wtPath);
        gitExecImpl(['commit', '-m', `chore: resolve merge conflicts with ${baseBranch}`], wtPath);
      }
    }

    gitExecImpl(['push', 'origin', `HEAD:refs/heads/${branch}`], wtPath);

    const token = process.env.GITHUB_TOKEN ?? '';
    const merged = await mergePRImpl({ repo: repoRef, prNumber, token });

    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge.conflict-resolved',
      payload: { prNumber, sha: merged.sha },
    });
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'gate.approved',
      payload: { source: 'conflict-resolver', prNumber },
    });
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'pr.merged',
      payload: { prNumber, sha: merged.sha },
    });

    await stateSource.transitionState(
      issueNumber,
      'factory:merge-conflict',
      'factory:retrospecting',
    );
    await stateSource.comment(
      issueNumber,
      buildAgentComment(
        'Resolve-Conflict',
        'Complete',
        `Merge conflict resolved — PR #${prNumber} merged`,
        [`SHA: ${merged.sha}`],
      ),
    );
  } catch (err: unknown) {
    eventStore.appendEvent({
      projectId: slug,
      workItemId,
      kind: 'merge.conflict-unresolvable',
      payload: { prNumber, prUrl, error: String(err) },
    });
    await stateSource.transitionState(issueNumber, 'factory:merge-conflict', 'factory:needs-human');
    await stateSource.comment(
      issueNumber,
      buildAgentComment(
        'Resolve-Conflict',
        'Failed',
        'Could not resolve automatically — manual merge required',
        [`PR: ${prUrl}`],
      ),
    );
  } finally {
    try {
      gitExecImpl(['worktree', 'remove', '--force', wtPath], repoRoot);
    } catch {
      // best-effort cleanup
    }
  }
}
