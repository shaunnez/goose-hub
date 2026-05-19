import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type FactoryContext, FactoryContextError, loadFactoryContext } from './context.js';
import {
  FileExistsInput,
  FileInfoInput,
  GetProjectContextInput,
  GetStackCommandsInput,
  ListDirInput,
  ListFilesInput,
  ReadFileInput,
  ReadManyFilesInput,
  RecordDecisionInput,
  SearchTextInput,
} from './schemas.js';
import {
  ToolDataMissingError,
  getProjectContext,
  getStackCommands,
  recordDecisionTool,
} from './tools/context.js';
import {
  fileExistsTool,
  fileInfoTool,
  listDirTool,
  listFilesTool,
  readFileTool,
  readManyFilesTool,
  searchTextTool,
} from './tools/read.js';

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
 * Phase 2 registers only the implementable subset of context tools
 * (`get_project_context`, `get_stack_commands`, `record_decision`). The
 * remaining tools land as their upstream data sources become available.
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
