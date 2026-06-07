import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BugCategory,
  BugEnhanceOutputSchema,
  type GroundedHints,
} from '@goose-hub/skills/bug-enhance/schema.js';
import { storeArtifact } from '../agent-artifacts/repository.js';
import type { AgentEvent } from '../event-stream/store.js';
import { eventStore } from '../event-stream/store.js';
import { logger } from '../logger.js';
import { getProjectBySlug } from '../projects/loader.js';
import type { AgentSpec } from './interface.js';
import { safeParseOutputForSchema } from './output-normalization.js';
import { readPromptWithContext } from './read-prompt.js';
import { recordAgentRun } from './run-record.js';
import { toJsonSchema } from './schema-bridge.js';
import { groundedHintsToSeed } from './scout-prefetch.js';
import { selectPersona } from './select-persona.js';
import { selectRuntime } from './select-runtime.js';
import { resolveSkillRuntimeForProject } from './skill-runtime-resolver.js';

const jsonSchema = toJsonSchema(BugEnhanceOutputSchema);
const UI_WEB_BUG_SIGNAL_RE =
  /\b(ui|browser|frontend|page|route|screen|modal|dialog|button|header|search|shortcut|keyboard|key|click|label|capture|cmd|command|apple)\b|⌘/i;

export interface BugEnhanceResult {
  /** Markdown sections to append after the original bug body, if any. */
  markdown: string | null;
  /** Structured grounding hints the caller can persist as a seed artifact. */
  groundedHints: GroundedHints | null;
}

export interface RunBugEnhanceInput {
  projectId: string;
  /**
   * The work-item id used for event/cost attribution. At inbox promotion the
   * GitHub issue doesn't exist yet, so callers pass `inbox:<inboxItemId>`.
   * At lazy invocation from the investigate workflow, this is the real
   * work-item id.
   */
  workItemId: string;
  title: string;
  body: string;
  /** Optional working directory for tool execution (e.g. worktree path). */
  workspaceDir?: string;
  /** Parent investigation run when bug-enhance runs lazily inside investigation. */
  parentRunId?: string;
}

/**
 * Runs the bug-enhance agent on a UI/web bug report. Returns the markdown to
 * append plus structured grounded hints (file/component/route candidates)
 * the caller can persist so downstream investigation starts anchored.
 * Returns `{ markdown: null, groundedHints: null }` on failure.
 */
export async function runBugEnhance(input: RunBugEnhanceInput): Promise<BugEnhanceResult> {
  const projectConfig = await getProjectBySlug(input.projectId);
  const bugEnhanceRuntime = resolveSkillRuntimeForProject({
    skill: 'bug-enhance',
    projectBudgets: projectConfig?.budgets,
    projectId: input.projectId,
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    role: 'triager',
    allowHoldoutOverride: projectConfig?.agentConfig?.allowHoldoutOverride,
  });
  const runtime = selectRuntime({
    configRuntime: projectConfig?.agentConfig?.runtime ?? 'auto',
    model: bugEnhanceRuntime.modelOverride,
    skillProvider: bugEnhanceRuntime.provider,
  });
  const parentRunId = input.parentRunId?.trim();
  const runId =
    parentRunId != null && parentRunId !== '' ? `${parentRunId}:bug-enhance` : crypto.randomUUID();
  const { personaId } = selectPersona(input.projectId, 'triager');

  let prompt: string;
  try {
    prompt = readPromptWithContext('bug-enhance', input.projectId);
  } catch (err) {
    logger.error('bug-enhance: failed to read prompt', { err: String(err) });
    return { markdown: null, groundedHints: null };
  }

  try {
    const pathGroundingPrompt = buildPathGroundingPrompt(input);
    const appendSystemPrompt =
      pathGroundingPrompt.length > 0 ? `${prompt}\n\n${pathGroundingPrompt}` : prompt;

    const baseSpec: AgentSpec = {
      runId,
      role: 'triager',
      skill: 'bug-enhance',
      ...(input.workspaceDir != null ? { workspaceDir: input.workspaceDir } : {}),
      context: {
        projectId: input.projectId,
        workItemId: input.workItemId,
        workItem: { title: input.title, body: input.body },
      },
      contextAllowlist: ['workItem'],
      freshContext: false,
      toolBundles: ['read'],
      toolExtras: [],
      budgets: bugEnhanceRuntime.budgets,
      modelOverride: bugEnhanceRuntime.modelOverride,
      personaId,
      outputJsonSchema: jsonSchema,
      appendSystemPrompt,
      ...(parentRunId != null && parentRunId !== ''
        ? {
            extraEventPayload: {
              parentRunId,
              investigationRunId: parentRunId,
            },
          }
        : {}),
    };

    let result = await runtime.run(baseSpec);

    const parsed = safeParseOutputForSchema(BugEnhanceOutputSchema, result.output);
    if (!parsed.success) {
      logger.warn('bug-enhance: output validation failed', {
        errors: parsed.error.issues,
        raw: JSON.stringify(result.output),
      });
      recordAgentRun({
        runId,
        personaId,
        workItemId: input.workItemId,
        projectId: input.projectId,
        role: 'triager',
        skill: 'bug-enhance',
        outcome: 'failure',
      });
      emitBugEnhanceEmpty({
        input,
        runId,
        reasons: ['output-validation-failed'],
        analysis: analyzeToolEvents(result.events),
        category: null,
        enhancedContentLength: 0,
        hasGroundedHints: false,
        details: {
          validationIssues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return { markdown: null, groundedHints: null };
    }

    let parsedData = parsed.data;
    let toolAnalysis = analyzeToolEvents(result.events);
    if (shouldRetryUiWebGrounding(input, parsedData, toolAnalysis)) {
      const retrySpec = buildGroundingRetrySpec(baseSpec);
      const retryResult = await runtime.run(retrySpec);
      const retryParsed = safeParseOutputForSchema(BugEnhanceOutputSchema, retryResult.output);
      if (retryParsed.success) {
        result = retryResult;
        parsedData = retryParsed.data;
        toolAnalysis = analyzeToolEvents(result.events);
      } else {
        logger.warn('bug-enhance: grounding retry output validation failed', {
          errors: retryParsed.error.issues,
          raw: JSON.stringify(retryResult.output),
        });
      }
    }

    const content = parsedData.enhancedContent.trim();
    if (content.length === 0) {
      logger.warn('bug-enhance: enhancedContent empty after trim', {
        runId,
        decisions: parsedData.decisionSummaries,
      });
    }
    const rawHints = hasUsableHints(parsedData.groundedHints) ? parsedData.groundedHints : null;
    const groundedHints = rawHints != null ? pruneNonExistentPaths(rawHints, input, runId) : null;
    const emptyReasons = buildEmptyReasons({
      category: parsedData.category,
      enhancedContentLength: content.length,
      hasGroundedHints: groundedHints != null,
      toolAnalysis,
    });
    if (emptyReasons.length > 0) {
      emitBugEnhanceEmpty({
        input,
        runId,
        reasons: emptyReasons,
        analysis: toolAnalysis,
        category: parsedData.category ?? null,
        enhancedContentLength: content.length,
        hasGroundedHints: groundedHints != null,
      });
    }
    return {
      markdown: content.length > 0 ? content : null,
      groundedHints,
    };
  } catch (err) {
    logger.error('bug-enhance: agent run failed', { err: String(err) });
    const replayedToolAnalysis = analyzeToolEvents(eventStore.replay({ runId }));
    emitBugEnhanceEmpty({
      input,
      runId,
      reasons:
        replayedToolAnalysis.blockedToolCallCount > 0
          ? ['tool-call-blocked']
          : ['no-tool-call-made'],
      analysis: replayedToolAnalysis,
      category: null,
      enhancedContentLength: 0,
      hasGroundedHints: false,
      details: { error: String(err) },
    });
    return { markdown: null, groundedHints: null };
  }
}

type BugEnhanceEmptyReason =
  | 'no-tool-call-made'
  | 'tool-call-blocked'
  | 'output-validation-failed'
  | 'category-unknown'
  | 'empty-enhanced-content'
  | 'no-grounded-hints';

interface ToolEventAnalysis {
  toolCallCount: number;
  repoIntelCallCount: number;
  blockedToolCallCount: number;
  blockedToolNames: string[];
}

function payloadRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizedToolName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith('mcp__factory-tools__')) {
    const localName = value.slice('mcp__factory-tools__'.length);
    return localName === 'repo_intel_query' ? 'repo_intel.query' : localName;
  }
  if (value === 'repo_intel_query') return 'repo_intel.query';
  return value;
}

function analyzeToolEvents(events: readonly AgentEvent[]): ToolEventAnalysis {
  let toolCallCount = 0;
  let repoIntelCallCount = 0;
  let blockedToolCallCount = 0;
  const blockedToolNames = new Set<string>();

  for (const event of events) {
    if (event.kind !== 'agent.tool-call') continue;
    toolCallCount++;
    const payload = payloadRecord(event.payload);
    const toolName = normalizedToolName(payload?.tool_name ?? payload?.toolName ?? payload?.tool);
    if (toolName === 'repo_intel.query') repoIntelCallCount++;
    if (payload?.blocked === true || payload?.status === 'failed') {
      blockedToolCallCount++;
      if (toolName != null) blockedToolNames.add(toolName);
    }
  }

  return {
    toolCallCount,
    repoIntelCallCount,
    blockedToolCallCount,
    blockedToolNames: Array.from(blockedToolNames),
  };
}

function buildEmptyReasons(input: {
  category?: BugCategory;
  enhancedContentLength: number;
  hasGroundedHints: boolean;
  toolAnalysis: ToolEventAnalysis;
}): BugEnhanceEmptyReason[] {
  const reasons = new Set<BugEnhanceEmptyReason>();
  if (input.toolAnalysis.toolCallCount === 0) reasons.add('no-tool-call-made');
  if (input.toolAnalysis.blockedToolCallCount > 0) reasons.add('tool-call-blocked');
  if (input.category === 'unknown') reasons.add('category-unknown');
  if (input.enhancedContentLength === 0) reasons.add('empty-enhanced-content');
  if (!input.hasGroundedHints) reasons.add('no-grounded-hints');
  return Array.from(reasons);
}

function shouldRetryUiWebGrounding(
  input: RunBugEnhanceInput,
  output: { category?: BugCategory; groundedHints?: GroundedHints },
  analysis: ToolEventAnalysis,
): boolean {
  if (analysis.toolCallCount > 0) return false;
  if (output.category != null && output.category !== 'unknown') return false;
  if (hasUsableHints(output.groundedHints)) return false;
  return UI_WEB_BUG_SIGNAL_RE.test(`${input.title}\n${input.body}`);
}

function buildGroundingRetrySpec(baseSpec: AgentSpec): AgentSpec {
  const instruction = [
    'Grounding retry: this bug report has UI-web signals but the first pass returned unknown without making a Factory read/search/file tool call.',
    'Classify it as ui-web unless a Factory evidence call proves a different surface.',
    'Before returning, call at least one Factory evidence tool: repo_intel.query, search_text, list_files, or read_file.',
    'Start from visible terms in the work item such as header, button, search, capture, shortcut, label, and key.',
  ].join('\n');

  return {
    ...baseSpec,
    runId: `${baseSpec.runId}:grounding-retry`,
    appendSystemPrompt:
      baseSpec.appendSystemPrompt != null && baseSpec.appendSystemPrompt.length > 0
        ? `${baseSpec.appendSystemPrompt}\n\n${instruction}`
        : instruction,
  };
}

function emitBugEnhanceEmpty(input: {
  input: RunBugEnhanceInput;
  runId: string;
  reasons: BugEnhanceEmptyReason[];
  analysis: ToolEventAnalysis;
  category: BugCategory | null;
  enhancedContentLength: number;
  hasGroundedHints: boolean;
  details?: Record<string, unknown>;
}): void {
  eventStore.appendEvent({
    projectId: input.input.projectId,
    workItemId: input.input.workItemId,
    kind: 'agent.bug-enhance-empty',
    payload: {
      source: input.input.parentRunId != null ? 'lazy' : 'promotion',
      runId: input.runId,
      reasons: input.reasons,
      category: input.category,
      enhancedContentLength: input.enhancedContentLength,
      hasGroundedHints: input.hasGroundedHints,
      toolCallCount: input.analysis.toolCallCount,
      repoIntelCallCount: input.analysis.repoIntelCallCount,
      blockedToolCallCount: input.analysis.blockedToolCallCount,
      blockedToolNames: input.analysis.blockedToolNames,
      ...(input.details != null ? input.details : {}),
    },
    runId: input.runId,
  });
}

const BODY_PATH_RE = /(?:[\w.-]+\/)+(?:[\w.-]+\.[A-Za-z0-9]+)/g;
const NEARBY_FILE_LIMIT = 8;
const NEARBY_FILE_DEPTH = 3;
const NEARBY_FILE_EXT_RE = /\.(?:tsx?|jsx?|md|json|css|scss|mjs|cjs)$/;

function buildPathGroundingPrompt(input: RunBugEnhanceInput): string {
  const base = input.workspaceDir ?? process.cwd();
  if (!existsSync(base)) return '';

  const mentionedPaths = extractMentionedPaths(`${input.title}\n${input.body}`);
  if (mentionedPaths.length === 0) return '';

  const lines = ['## Factory preflight path grounding', ''];
  let hasGrounding = false;

  for (const mentionedPath of mentionedPaths) {
    const abs = join(base, mentionedPath);
    if (existsSync(abs)) {
      lines.push(`- Existing issue-mentioned path: \`${mentionedPath}\``);
      hasGrounding = true;
      continue;
    }

    const nearby = findNearbyFiles(base, mentionedPath);
    lines.push(`- Missing issue-mentioned path: \`${mentionedPath}\``);
    if (nearby.length > 0) {
      lines.push(`  Nearby existing files: ${nearby.map((path) => `\`${path}\``).join(', ')}`);
    } else {
      lines.push('  Nearby existing files: none found with a shallow local scan');
    }
    hasGrounding = true;
  }

  if (!hasGrounding) return '';
  lines.push('', 'Use existing nearby files as grounding targets; do not read missing paths.');
  return lines.join('\n');
}

function extractMentionedPaths(text: string): string[] {
  return Array.from(new Set(text.match(BODY_PATH_RE) ?? []));
}

function findNearbyFiles(base: string, missingPath: string): string[] {
  const parts = missingPath.split('/').filter(Boolean);
  while (parts.length > 0) {
    parts.pop();
    const relDir = parts.join('/');
    const absDir = relDir.length === 0 ? base : join(base, relDir);
    if (!isDirectory(absDir)) continue;
    const files = collectNearbyFiles(base, relDir, NEARBY_FILE_DEPTH);
    return rankNearbyFiles(files, missingPath).slice(0, NEARBY_FILE_LIMIT);
  }
  return [];
}

function collectNearbyFiles(base: string, relDir: string, depth: number): string[] {
  const absDir = relDir.length === 0 ? base : join(base, relDir);
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relPath = relDir.length === 0 ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isFile() && NEARBY_FILE_EXT_RE.test(entry.name)) {
      files.push(relPath);
      continue;
    }
    if (depth > 0 && entry.isDirectory()) {
      files.push(...collectNearbyFiles(base, relPath, depth - 1));
    }
  }
  return files;
}

function rankNearbyFiles(files: string[], missingPath: string): string[] {
  const missingName =
    missingPath
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? missingPath;
  return [...files].sort(
    (a, b) => scoreNearbyFile(a, missingName) - scoreNearbyFile(b, missingName),
  );
}

function scoreNearbyFile(file: string, missingName: string): number {
  const fileName =
    file
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? file;
  const prefix = commonPrefixLength(fileName.toLowerCase(), missingName.toLowerCase());
  return -prefix;
}

function commonPrefixLength(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pruneNonExistentPaths(
  hints: GroundedHints,
  input: RunBugEnhanceInput,
  runId: string,
): GroundedHints | null {
  const base = input.workspaceDir ?? process.cwd();

  // If the workspace itself doesn't exist, don't prune — the worktree may not
  // be initialised yet (inbox promotion path). Emit a warning and pass through.
  if (!existsSync(base)) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.bug-enhance-workspace-empty',
      payload: { workspaceDir: base, runId },
      runId,
    });
    return hints;
  }

  const prunedFiles = hints.candidateFiles.filter((f) => existsSync(join(base, f.path)));
  const prunedComponents = hints.candidateComponents.filter(
    (c) => c.file == null || existsSync(join(base, c.file)),
  );

  const allFilesPruned = hints.candidateFiles.length > 0 && prunedFiles.length === 0;

  if (allFilesPruned) {
    eventStore.appendEvent({
      projectId: input.projectId,
      workItemId: input.workItemId,
      kind: 'agent.bug-enhance-hallucinated',
      payload: {
        droppedCount: hints.candidateFiles.length,
        originalCount: hints.candidateFiles.length,
        runId,
      },
      runId,
    });
    return null;
  }

  return {
    ...hints,
    candidateFiles: prunedFiles,
    candidateComponents: prunedComponents,
  };
}

function hasUsableHints(hints: GroundedHints | undefined): hints is GroundedHints {
  if (hints == null) return false;
  return (
    hints.candidateFiles.length > 0 ||
    hints.candidateComponents.length > 0 ||
    hints.candidateRoutes.length > 0
  );
}

export interface PersistGroundedSeedInput {
  projectId: string;
  workItemId: string;
  runId: string;
  hints: GroundedHints;
}

/**
 * Persists bug-enhance's grounded hints as an `investigation-seed` artifact
 * keyed under the work-item id. The downstream investigation/dev runs read
 * this artifact via `defaultLoadGroundedSeed` in scout-prefetch so they
 * start anchored to real files instead of brute-search.
 */
export function persistGroundedSeed(input: PersistGroundedSeedInput): void {
  try {
    const seed = groundedHintsToSeed({
      candidateFiles: input.hints.candidateFiles,
      candidateComponents: input.hints.candidateComponents,
    });
    storeArtifact({
      projectId: input.projectId,
      workItemId: input.workItemId,
      runId: input.runId,
      kind: 'investigation-seed',
      artifactKey: `investigation-seed:promotion:${input.workItemId}`,
      summary: `Grounded seed for ${input.workItemId} (bug-enhance)`,
      payload: seed,
    });
  } catch (err) {
    logger.warn('bug-enhance: failed to persist grounded seed', {
      workItemId: input.workItemId,
      err: String(err),
    });
  }
}
