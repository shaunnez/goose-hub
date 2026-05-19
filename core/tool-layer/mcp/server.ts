import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type FactoryContext, FactoryContextError, loadFactoryContext } from './context.js';
import {
  ApplyPatchInput,
  CreateDirectoryInput,
  DeleteFileInput,
  EditFileInput,
  FileExistsInput,
  FileInfoInput,
  GetAppUrlInput,
  GetChangedFilesInput,
  GetDiffInput,
  GetHeadShaInput,
  GetMergeBaseInput,
  GetPrDiffInput,
  GetProjectContextInput,
  GetStackCommandsInput,
  GetStatusInput,
  ListDirInput,
  ListFilesInput,
  MoveFileInput,
  ReadFileInput,
  ReadManyFilesInput,
  RecordDecisionInput,
  RunFullSuiteIfNeededInput,
  RunIsolatedTestInput,
  RunLintInput,
  RunPackageScriptInput,
  RunPlaywrightSpecInput,
  RunTargetedCommandInput,
  RunTestsInput,
  RunTypecheckInput,
  SearchTextInput,
  WriteFileInput,
  WritePlaywrightSpecInput,
} from './schemas.js';
import {
  ToolDataMissingError,
  getProjectContext,
  getStackCommands,
  recordDecisionTool,
} from './tools/context.js';
import { getAppUrlTool, runPlaywrightSpecTool, writePlaywrightSpecTool } from './tools/evidence.js';
import {
  getChangedFilesTool,
  getDiffTool,
  getHeadShaTool,
  getMergeBaseTool,
  getStatusTool,
} from './tools/git.js';
import { getPrDiffTool, runFullSuiteIfNeededTool, runIsolatedTestTool } from './tools/qa.js';
import {
  fileExistsTool,
  fileInfoTool,
  listDirTool,
  listFilesTool,
  readFileTool,
  readManyFilesTool,
  searchTextTool,
} from './tools/read.js';
import {
  runLintTool,
  runPackageScriptTool,
  runTargetedCommandTool,
  runTestsTool,
  runTypecheckTool,
} from './tools/verify.js';
import {
  applyPatchTool,
  createDirectoryTool,
  deleteFileTool,
  editFileTool,
  moveFileTool,
  writeFileTool,
} from './tools/write.js';

const SERVER_NAME = 'factory-tools';
const SERVER_VERSION = '0.1.0';

interface JsonContent {
  type: 'text';
  text: string;
}

function jsonContent(value: unknown): JsonContent[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

function errorResult(err: unknown): { content: JsonContent[]; isError: true } {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : 'Unknown tool error.';
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Builds the McpServer with every tool the agent is allowed to invoke. Tool
 * implementations live in `tools/*` and are pure functions of
 * `(FactoryContext, validatedInput)`; the server is a thin envelope that
 * wires schema, handler, and error mapping.
 *
 * Tools whose upstream data source does not yet exist (`get_work_item`,
 * `get_handoff`, `get_verification_summary`, `check_acceptance_criteria`,
 * `collect_evidence`, `validate_evidence_artifacts`,
 * `package_evidence_packet`) have schemas in `schemas.ts` but are not yet
 * registered here. Workflow-owned mutations (`stage_changes`,
 * `commit_changes`, `open_pr`, etc.) are intentionally never registered —
 * they live on the orchestrator side and are reachable only through
 * explicit workflow delegation.
 */
export function buildFactoryMcpServer(ctx: FactoryContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'get_project_context',
    {
      description:
        'Return the project config slice visible to the agent: id, name, slug, mode, active milestone, repos.',
      inputSchema: GetProjectContextInput.shape,
    },
    async (input) => {
      try {
        const result = await getProjectContext(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_stack_commands',
    {
      description:
        "Return the project's stack commands (runtime, packageManager, test/lint/typecheck/build/e2e).",
      inputSchema: GetStackCommandsInput.shape,
    },
    async (input) => {
      try {
        const result = await getStackCommands(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'record_decision',
    {
      description:
        'Record a structured decision (kind, what, why) to the agent_decisions SQLite table. Unknown kinds are rejected by the schema.',
      inputSchema: RecordDecisionInput.shape,
    },
    async (input) => {
      try {
        const result = recordDecisionTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'read_file',
    {
      description:
        'Read a workspace-relative file. Optional startLine/lineCount slice for large files; 256 KB byte cap; truncation flagged in the result.',
      inputSchema: ReadFileInput.shape,
    },
    async (input) => {
      try {
        const result = await readFileTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'read_many_files',
    {
      description:
        'Read up to 50 workspace-relative files in one call. Per-file errors are reported in the `errors` array rather than aborting the batch.',
      inputSchema: ReadManyFilesInput.shape,
    },
    async (input) => {
      try {
        const result = await readManyFilesTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_dir',
    {
      description:
        'List directory entries (name + kind). Optional depth up to 3; entry count capped at 500.',
      inputSchema: ListDirInput.shape,
    },
    async (input) => {
      try {
        const result = await listDirTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'list_files',
    {
      description:
        'List files via ripgrep (respects .gitignore). Optional glob + path filter; result count capped at 500.',
      inputSchema: ListFilesInput.shape,
    },
    async (input) => {
      try {
        const result = await listFilesTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'search_text',
    {
      description:
        'Search file contents via ripgrep. Returns structured `{path, line, text}` matches; capped at 200 matches per call.',
      inputSchema: SearchTextInput.shape,
    },
    async (input) => {
      try {
        const result = await searchTextTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'file_exists',
    {
      description: 'Cheap existence check for a workspace-relative path.',
      inputSchema: FileExistsInput.shape,
    },
    async (input) => {
      try {
        const result = await fileExistsTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'file_info',
    {
      description:
        'Returns size, kind, mtime, and isSymlink for a workspace-relative path. Reports exists=false for missing paths rather than throwing.',
      inputSchema: FileInfoInput.shape,
    },
    async (input) => {
      try {
        const result = await fileInfoTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'write_file',
    {
      description:
        'Write content to a workspace-relative path. Parent directories are created on demand. Reports `created` true for new files, false for overwrites.',
      inputSchema: WriteFileInput.shape,
    },
    async (input) => {
      try {
        const result = await writeFileTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'edit_file',
    {
      description:
        'Replace `oldString` with `newString`. Requires a unique match unless `replaceAll: true`; zero matches throws.',
      inputSchema: EditFileInput.shape,
    },
    async (input) => {
      try {
        const result = await editFileTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'apply_patch',
    {
      description:
        'Apply a unified diff via `git apply`. Patches that touch paths outside the worktree are refused by git itself.',
      inputSchema: ApplyPatchInput.shape,
    },
    async (input) => {
      try {
        const result = await applyPatchTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'create_directory',
    {
      description: 'mkdir -p for a workspace-relative path. Idempotent.',
      inputSchema: CreateDirectoryInput.shape,
    },
    async (input) => {
      try {
        const result = await createDirectoryTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'move_file',
    {
      description:
        'Rename or move a workspace-relative file. Parent directories are created on demand.',
      inputSchema: MoveFileInput.shape,
    },
    async (input) => {
      try {
        const result = await moveFileTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'delete_file',
    {
      description:
        'Delete a single workspace-relative file. Directories are refused — move them to a workflow-owned trash path instead.',
      inputSchema: DeleteFileInput.shape,
    },
    async (input) => {
      try {
        const result = await deleteFileTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_tests',
    {
      description:
        "Run the project's testCommand from the worktree root. Optional `path` narrows scope to a workspace-relative file or directory; 5-minute timeout.",
      inputSchema: RunTestsInput.shape,
    },
    async (input) => {
      try {
        const result = await runTestsTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_lint',
    {
      description:
        "Run the project's lintCommand. Optional `path` narrows scope. 90-second timeout.",
      inputSchema: RunLintInput.shape,
    },
    async (input) => {
      try {
        const result = await runLintTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_typecheck',
    {
      description:
        "Run the project's typecheckCommand (no path narrowing — typecheck is whole-project). 3-minute timeout.",
      inputSchema: RunTypecheckInput.shape,
    },
    async (input) => {
      try {
        const result = await runTypecheckTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_package_script',
    {
      description:
        'Run a package.json script via the project package manager. Script name must exist in package.json#scripts.',
      inputSchema: RunPackageScriptInput.shape,
    },
    async (input) => {
      try {
        const result = await runPackageScriptTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_targeted_command',
    {
      description:
        'Convenience wrapper for run_tests / run_lint / run_typecheck narrowed to a single path.',
      inputSchema: RunTargetedCommandInput.shape,
    },
    async (input) => {
      try {
        const result = await runTargetedCommandTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_status',
    {
      description:
        'Working-tree status (branch, ahead/behind, structured entries with staged flag) via `git status --porcelain=v2 --branch`.',
      inputSchema: GetStatusInput.shape,
    },
    async (input) => {
      try {
        const result = await getStatusTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_changed_files',
    {
      description: 'Flat list of changed-or-untracked workspace-relative paths.',
      inputSchema: GetChangedFilesInput.shape,
    },
    async (input) => {
      try {
        const result = await getChangedFilesTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_diff',
    {
      description:
        'Diff for the working tree (or the index when `staged: true`). Capped at 512 KB; truncation flagged.',
      inputSchema: GetDiffInput.shape,
    },
    async (input) => {
      try {
        const result = await getDiffTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_head_sha',
    {
      description: 'Current HEAD commit sha.',
      inputSchema: GetHeadShaInput.shape,
    },
    async (input) => {
      try {
        const result = await getHeadShaTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_merge_base',
    {
      description:
        'Merge base between HEAD and `ref` (defaults to origin/main). `base: null` means no common ancestor was found.',
      inputSchema: GetMergeBaseInput.shape,
    },
    async (input) => {
      try {
        const result = await getMergeBaseTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_pr_diff',
    {
      description:
        'Diff for a pull request resolved from `refs/pull/<n>/head` or `pr/<n>`. Throws PrDiffUnavailableError when no local ref exists.',
      inputSchema: GetPrDiffInput.shape,
    },
    async (input) => {
      try {
        const result = await getPrDiffTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_full_suite_if_needed',
    {
      description:
        "Runs the project's full test suite. The 'if needed' decision is workflow-owned — this tool always runs and reports the result.",
      inputSchema: RunFullSuiteIfNeededInput.shape,
    },
    async (input) => {
      try {
        const result = await runFullSuiteIfNeededTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_isolated_test',
    {
      description:
        'Run the project test command narrowed to a single file. Optional `testName` appends a name filter as a second positional arg.',
      inputSchema: RunIsolatedTestInput.shape,
    },
    async (input) => {
      try {
        const result = await runIsolatedTestTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_app_url',
    {
      description:
        'Return the URL where the app under test is running (from FACTORY_APP_URL env). Returns url=null when unset.',
      inputSchema: GetAppUrlInput.shape,
    },
    async (input) => {
      try {
        const result = getAppUrlTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'write_playwright_spec',
    {
      description:
        'Write a Playwright spec to apps/web/e2e/. Path must end in .spec.ts(x) and live under apps/web/e2e/.',
      inputSchema: WritePlaywrightSpecInput.shape,
    },
    async (input) => {
      try {
        const result = await writePlaywrightSpecTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'run_playwright_spec',
    {
      description:
        "Run a Playwright spec via the project's e2eCommand. Spec path is positional; FACTORY_APP_URL and mock-mode env vars propagate when set.",
      inputSchema: RunPlaywrightSpecInput.shape,
    },
    async (input) => {
      try {
        const result = await runPlaywrightSpecTool(ctx, input);
        return { content: jsonContent(result), structuredContent: { ...result } };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  let ctx: FactoryContext;
  try {
    ctx = loadFactoryContext();
  } catch (err) {
    if (err instanceof FactoryContextError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  const server = buildFactoryMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/core/tool-layer/mcp/server.ts')
) {
  void main();
}

export { ToolDataMissingError };
