import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type FactoryContext, FactoryContextError, loadFactoryContext } from './context.js';
import { GetProjectContextInput, GetStackCommandsInput, RecordDecisionInput } from './schemas.js';
import {
  ToolDataMissingError,
  getProjectContext,
  getStackCommands,
  recordDecisionTool,
} from './tools/context.js';

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
