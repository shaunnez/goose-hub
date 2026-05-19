import { z } from 'zod';
import { DecisionKindSchema } from '../../agent-runtime/decision-types.js';

const WorkspacePath = z
  .string()
  .min(1)
  .describe(
    'Workspace-relative path. Absolute paths, .., ~, .codex, .agents, .claude, .factory are rejected.',
  );

const WorkspacePaths = z.array(WorkspacePath).min(1).max(50);

// ─── context ─────────────────────────────────────────────────────────────────

export const GetWorkItemInput = z.object({}).strict();

export const GetProjectContextInput = z.object({}).strict();

export const GetStackCommandsInput = z.object({}).strict();

export const RecordDecisionInput = z
  .object({
    kind: DecisionKindSchema,
    what: z.string().min(1).max(500),
    why: z.string().min(1).max(2000),
    iteration: z.number().int().min(0).optional(),
    phase: z.string().max(64).optional(),
  })
  .strict();

// ─── read / search ───────────────────────────────────────────────────────────

export const ReadFileInput = z
  .object({
    path: WorkspacePath,
    startLine: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

export const ReadManyFilesInput = z.object({ paths: WorkspacePaths }).strict();

export const ListDirInput = z
  .object({ path: WorkspacePath, depth: z.number().int().min(1).max(3).optional() })
  .strict();

export const ListFilesInput = z
  .object({
    path: WorkspacePath.optional(),
    glob: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export const SearchTextInput = z
  .object({
    query: z.string().min(1).max(500),
    path: WorkspacePath.optional(),
    glob: z.string().min(1).max(200).optional(),
    maxMatches: z.number().int().min(1).max(500).optional(),
    contextLines: z.number().int().min(0).max(10).optional(),
  })
  .strict();

export const FileExistsInput = z.object({ path: WorkspacePath }).strict();

export const FileInfoInput = z.object({ path: WorkspacePath }).strict();

// ─── write / edit ────────────────────────────────────────────────────────────

export const WriteFileInput = z.object({ path: WorkspacePath, content: z.string() }).strict();

export const EditFileInput = z
  .object({
    path: WorkspacePath,
    oldString: z.string().min(1),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

export const ApplyPatchInput = z
  .object({ path: WorkspacePath, patch: z.string().min(1).max(200_000) })
  .strict();

export const CreateDirectoryInput = z.object({ path: WorkspacePath }).strict();

export const MoveFileInput = z.object({ from: WorkspacePath, to: WorkspacePath }).strict();

export const DeleteFileInput = z.object({ path: WorkspacePath }).strict();

// ─── verification ────────────────────────────────────────────────────────────

const TargetedPath = WorkspacePath.optional().describe(
  'Optional workspace-relative path. When provided, runner narrows scope to this path.',
);

export const RunTestsInput = z
  .object({ path: TargetedPath, watch: z.literal(false).optional() })
  .strict();

export const RunLintInput = z.object({ path: TargetedPath }).strict();

export const RunTypecheckInput = z.object({}).strict();

export const RunPackageScriptInput = z
  .object({
    script: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9:_-]+$/i, 'package.json script name'),
  })
  .strict();

export const RunTargetedCommandInput = z
  .object({
    family: z.enum(['test', 'lint', 'typecheck']),
    path: WorkspacePath,
  })
  .strict();

// ─── evidence ────────────────────────────────────────────────────────────────

export const GetAppUrlInput = z.object({}).strict();

export const WritePlaywrightSpecInput = z
  .object({ path: WorkspacePath, content: z.string().min(1) })
  .strict();

export const RunPlaywrightSpecInput = z
  .object({ spec: WorkspacePath, project: z.string().min(1).max(64).optional() })
  .strict();

export const CollectEvidenceInput = z
  .object({
    resultsPath: WorkspacePath,
    phase: z.enum(['before', 'after']).default('before'),
    /** Workspace-relative output directory; defaults to `evidence/<issue>/`. */
    evidenceDir: WorkspacePath.optional(),
    /** Skip ffmpeg post-processing (useful when ffmpeg is not installed). */
    skipFfmpeg: z.boolean().optional(),
  })
  .strict();

// `validate_evidence_artifacts`, `package_evidence_packet`, and
// `publish_evidence` from the original ADR catalog are workflow-internal
// concerns owned by `slices/fix-issue/evidence-post-workflow.ts`. They
// were dropped from the agent surface in favour of the workflow keeping
// direct access to its existing helpers.

// ─── git / diff (read-only) ──────────────────────────────────────────────────

export const GetStatusInput = z.object({}).strict();

export const GetChangedFilesInput = z.object({}).strict();

export const GetDiffInput = z.object({ staged: z.boolean().optional() }).strict();

export const GetHeadShaInput = z.object({}).strict();

export const GetMergeBaseInput = z.object({ ref: z.string().min(1).max(200).optional() }).strict();

export const GetLogInput = z
  .object({
    path: WorkspacePath.optional(),
    /** Maximum commits to return (default 50, cap 500). */
    limit: z.number().int().min(1).max(500).optional(),
    /** Range expression, e.g. `origin/main..HEAD` or `<sha>..<sha>`. */
    range: z.string().min(1).max(200).optional(),
  })
  .strict();

export const GetBlameInput = z
  .object({
    path: WorkspacePath,
    /** Optional line range to blame (inclusive). */
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  })
  .strict();

// ─── workflow-owned (not exposed to agent bundles) ───────────────────────────

export const StageChangesInput = z.object({ paths: WorkspacePaths.optional() }).strict();

export const CommitChangesInput = z.object({ message: z.string().min(1).max(4000) }).strict();

export const OpenPrInput = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().max(50_000).optional(),
    base: z.string().min(1).max(200).optional(),
  })
  .strict();

export const UpdatePrInput = z
  .object({
    prNumber: z.number().int().min(1),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(50_000).optional(),
  })
  .strict();

export const PostIssueCommentInput = z
  .object({ issueNumber: z.number().int().min(1), body: z.string().min(1).max(50_000) })
  .strict();

export const TransitionStateInput = z
  .object({ issueNumber: z.number().int().min(1), to: z.string().min(1).max(64) })
  .strict();

// ─── qa / review ─────────────────────────────────────────────────────────────

export const GetPrDiffInput = z.object({ prNumber: z.number().int().min(1) }).strict();

export const GetVerificationSummaryInput = z.object({}).strict();

export const RunFullSuiteIfNeededInput = z.object({}).strict();

export const RunIsolatedTestInput = z
  .object({ path: WorkspacePath, testName: z.string().min(1).max(500).optional() })
  .strict();

export const CheckAcceptanceCriteriaInput = z.object({}).strict();

// ─── tool name catalog ───────────────────────────────────────────────────────

/**
 * Canonical tool names. The full prefix surfaced to agents is
 * `mcp__factory-tools__<name>`; the runtime adds that prefix when building
 * the per-role allowlist.
 */
export const FACTORY_TOOL_NAMES = [
  // context
  'get_work_item',
  'get_project_context',
  'get_stack_commands',
  'record_decision',
  // read / search
  'read_file',
  'read_many_files',
  'list_dir',
  'list_files',
  'search_text',
  'file_exists',
  'file_info',
  // write / edit
  'write_file',
  'edit_file',
  'apply_patch',
  'create_directory',
  'move_file',
  'delete_file',
  // verification
  'run_tests',
  'run_lint',
  'run_typecheck',
  'run_package_script',
  'run_targeted_command',
  // evidence
  'get_app_url',
  'write_playwright_spec',
  'run_playwright_spec',
  'collect_evidence',
  // git / diff (read-only)
  'get_status',
  'get_changed_files',
  'get_diff',
  'get_head_sha',
  'get_merge_base',
  'get_log',
  'get_blame',
  // workflow-owned (NOT registered on the MCP server, NOT in any agent bundle)
  'stage_changes',
  'commit_changes',
  'open_pr',
  'update_pr',
  'post_issue_comment',
  'transition_state',
  // qa / review
  'get_pr_diff',
  'get_verification_summary',
  'run_full_suite_if_needed',
  'run_isolated_test',
  'check_acceptance_criteria',
] as const;

export type FactoryToolName = (typeof FACTORY_TOOL_NAMES)[number];
