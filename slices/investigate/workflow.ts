import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliRuntime } from '@goose-hub/core/agent-runtime/claude-cli.js';
import { toJsonSchema } from '@goose-hub/core/agent-runtime/schema-bridge.js';
import { selectPersona } from '@goose-hub/core/agent-runtime/select-persona.js';
import { eventStore } from '@goose-hub/core/event-stream/store.js';
import { accumulatePersonaStats } from '@goose-hub/core/persona/accumulate.js';
import type { StateSource, WorkItem } from '@goose-hub/core/state-source/interface.js';
import { cleanupWorktree, createWorktree } from '@goose-hub/core/workspaces/worktree.js';
import { InvestigateSchema } from '@goose-hub/skills/investigate/schema.js';
import { PlaywrightReproSchema } from '@goose-hub/skills/playwright-repro/schema.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

/**
 * The Claude CLI subprocess is spawned with a minimal PATH (see
 * core/agent-runtime/claude-cli.ts). Mirror that PATH here so the pre-flight
 * detects the same `pnpm`/`playwright` resolution failures the spawn would hit.
 */
const MINIMAL_PATH =
  process.platform === 'darwin'
    ? '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    : '/usr/local/bin:/usr/bin:/bin';

function readPrompt(skillName: string): string {
  return readFileSync(join(REPO_ROOT, 'skills', skillName, 'skill.md'), 'utf8');
}

/**
 * Spawns the playwright-test MCP server briefly to confirm it can start in the
 * environment the Claude CLI subprocess will use. Resolves with `{ ok: true }`
 * if the process is still alive after `probeMs` (the server is long-running and
 * never exits on its own), or with `{ ok: false, error }` if it exits early or
 * fails to spawn at all (missing pnpm, missing playwright, missing browsers).
 */
async function preflightPlaywrightMcp(
  probeMs = 3000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let stderr = '';
    let resolved = false;
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      resolve(result);
    };

    const child = spawn(
      'pnpm',
      ['--filter', '@goose-hub/web', 'exec', 'playwright', 'run-test-mcp-server', '--headless'],
      {
        cwd: REPO_ROOT,
        env: { HOME: homedir(), PATH: MINIMAL_PATH },
        shell: false,
        // stdin must stay open (pipe, not ignore) — stdio MCP servers exit on EOF
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => finish({ ok: false, error: `spawn failed: ${err.message}` }));
    child.on('exit', (code) =>
      finish({
        ok: false,
        error: `MCP server exited early with code ${code}: ${stderr.slice(0, 500).trim() || '(no stderr)'}`,
      }),
    );
    setTimeout(() => finish({ ok: true }), probeMs);
  });
}

/**
 * Runs the investigate workflow for a work item in `factory:investigating` state.
 *
 * Workflow:
 * 1. createWorktree for the target repo
 * 2. Run the `investigate` skill (investigator persona, opus-tier)
 * 3. If type:bug, run the `playwright-repro` skill
 * 4. Persist findings as `agent.investigation-complete` event
 * 5. Transition state: factory:investigating → factory:investigation-complete
 *
 * On failure: cleanup worktree, persist agent.run-failed event,
 * post GitHub comment, transition to factory:needs-human.
 */
export async function runInvestigateWorkflow(
  workItem: WorkItem,
  stateSource: StateSource,
  projectId: string,
  targetRepo: string,
): Promise<void> {
  const runId = crypto.randomUUID();
  const runtime = new ClaudeCliRuntime();
  const investigatePrompt = readPrompt('investigate');
  const playwrightReproPrompt = readPrompt('playwright-repro');
  const investigateJsonSchema = toJsonSchema(InvestigateSchema);
  const playwrightReproJsonSchema = toJsonSchema(PlaywrightReproSchema);

  const { personaId } = selectPersona(projectId, 'investigator');
  const worktreePath = createWorktree(targetRepo, runId);

  try {
    // Step a: Run the investigate skill
    const investigateResult = await runtime.run({
      runId,
      role: 'investigator',
      skill: 'investigate',
      context: {
        projectId,
        workItemId: workItem.id,
        workItem: {
          title: workItem.title,
          body: workItem.body,
          number: Number(workItem.externalId),
        },
        worktreePath,
      },
      contextAllowlist: ['workItem', 'worktreePath'],
      freshContext: false,
      toolBundles: ['read-only'],
      toolExtras: [],
      budgets: { maxTurns: 100, maxBudgetUsd: 2, timeoutMs: 300_000 },
      personaId,
      modelOverride: 'claude-opus-4-7',
      outputJsonSchema: investigateJsonSchema,
      appendSystemPrompt: investigatePrompt,
    });

    // Step b: Validate investigate output
    const investigateParsed = InvestigateSchema.safeParse(investigateResult.output);
    if (!investigateParsed.success) {
      throw new Error(
        `Investigate output validation failed: ${JSON.stringify(investigateParsed.error.issues)}`,
      );
    }
    const findings = investigateParsed.data;

    // Step c: If type:bug, run playwright-repro skill
    let reproOutput: unknown | undefined;
    if (workItem.type === 'bug') {
      const { personaId: playwrightPersonaId } = selectPersona(projectId, 'investigator');
      const playwrightRunId = crypto.randomUUID();

      // Pre-flight: confirm the MCP server can actually start before spawning
      // an agent that has only browser_* tools and no fallback. Skipped under
      // MOCK_AGENTS=true to match the runtime bypass in claude-cli.ts.
      const preflight =
        process.env.MOCK_AGENTS === 'true' ? { ok: true as const } : await preflightPlaywrightMcp();
      if (!preflight.ok) {
        eventStore.appendEvent({
          projectId,
          workItemId: workItem.id,
          kind: 'agent.run-failed',
          payload: {
            runId: playwrightRunId,
            skill: 'playwright-repro',
            error: `playwright-test MCP server pre-flight failed: ${preflight.error}`,
          },
          runId: playwrightRunId,
        });
      } else {
        // Write a runtime MCP config that invokes playwright via pnpm from the
        // actual repo root (where node_modules exist). The worktree is isolated
        // from node_modules, so npx/direct invocation fails there.
        const playwrightMcpConfigPath = join(
          homedir(),
          '.factory',
          'workspaces',
          `${playwrightRunId}-mcp.json`,
        );
        mkdirSync(join(homedir(), '.factory', 'workspaces'), { recursive: true });
        writeFileSync(
          playwrightMcpConfigPath,
          JSON.stringify({
            mcpServers: {
              'playwright-test': {
                command: 'pnpm',
                args: [
                  '--filter',
                  '@goose-hub/web',
                  'exec',
                  'playwright',
                  'run-test-mcp-server',
                  '--headless',
                ],
                cwd: REPO_ROOT,
              },
            },
          }),
        );

        try {
          const playwrightResult = await runtime.run({
            runId: playwrightRunId,
            role: 'investigator',
            skill: 'playwright-repro',
            workspaceDir: worktreePath,
            context: {
              projectId,
              workItemId: workItem.id,
              workItem: {
                title: workItem.title,
                body: workItem.body,
                reproSteps: workItem.body,
              },
              appUrl: 'http://localhost:5173',
            },
            contextAllowlist: ['workItem', 'appUrl'],
            freshContext: false,
            toolBundles: ['playwright-mcp'],
            toolExtras: [],
            budgets: { maxTurns: 25, maxBudgetUsd: 5, timeoutMs: 120_000 },
            personaId: playwrightPersonaId,
            mcpConfigPath: playwrightMcpConfigPath,
            outputJsonSchema: playwrightReproJsonSchema,
            appendSystemPrompt: playwrightReproPrompt,
          });

          const reproparsed = PlaywrightReproSchema.safeParse(playwrightResult.output);
          if (reproparsed.success) {
            reproOutput = reproparsed.data;
          } else {
            // Most common cause: agent ran but the MCP server never registered
            // its tools, so the agent returned a free-text "I cannot do this"
            // instead of a schema-conforming JSON object. Capture a preview so
            // the actual agent output is visible in the event stream.
            const preview =
              typeof playwrightResult.output === 'string'
                ? playwrightResult.output.slice(0, 800)
                : JSON.stringify(playwrightResult.output).slice(0, 800);
            eventStore.appendEvent({
              projectId,
              workItemId: workItem.id,
              kind: 'agent.run-failed',
              payload: {
                runId: playwrightRunId,
                skill: 'playwright-repro',
                error: `Output validation failed: ${JSON.stringify(reproparsed.error.issues)}`,
                outputPreview: preview,
              },
              runId: playwrightRunId,
            });
          }
        } catch (err) {
          // playwright-repro failure is non-fatal — investigate findings are
          // persisted regardless. But never silent: emit the actual error so
          // operators can diagnose MCP startup, --strict-mcp-config rejections,
          // missing browsers, etc.
          const error = err instanceof Error ? err : new Error(String(err));
          eventStore.appendEvent({
            projectId,
            workItemId: workItem.id,
            kind: 'agent.run-failed',
            payload: {
              runId: playwrightRunId,
              skill: 'playwright-repro',
              error: error.message,
            },
            runId: playwrightRunId,
          });
        }
      }
    }

    // Step d: Persist findings as agent.investigation-complete event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.investigation-complete',
      payload: {
        investigate: findings,
        playwrightRepro: reproOutput,
      },
      runId,
    });

    // Step e: Transition state
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'success' });
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:investigation-complete',
    );
  } catch (err) {
    accumulatePersonaStats({ personaName: personaId, role: 'investigator', outcome: 'failure' });
    const error = err instanceof Error ? err : new Error(String(err));

    // Persist failure event
    eventStore.appendEvent({
      projectId,
      workItemId: workItem.id,
      kind: 'agent.run-failed',
      payload: { runId, error: error.message },
      runId,
    });

    // Post GitHub comment
    await stateSource.comment(workItem.externalId, `Investigation failed: ${error.message}`);

    // Transition to error state
    await stateSource.transitionState(
      workItem.externalId,
      'factory:investigating',
      'factory:needs-human',
    );
  } finally {
    // Always cleanup the worktree — cleanupWorktree is idempotent
    cleanupWorktree(runId);
  }
}
