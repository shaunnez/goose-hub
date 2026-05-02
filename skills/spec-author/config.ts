import type { SkillConfig } from '@goose-hub/core/agent-runtime/interface.js';
import { z } from 'zod';

/**
 * Context expected by the spec-author agent. Rendered as XML in the user prompt:
 *
 *   <task>
 *     <work_item>
 *       <title>...</title>
 *       <body>...</body>
 *       <number>...</number>
 *     </work_item>
 *     <target_url>http://localhost:5173/...</target_url>
 *     <slice_description>...</slice_description>
 *   </task>
 */
export const SpecAuthorContextSchema = z.object({
  workItem: z.object({
    title: z.string(),
    body: z.string(),
    number: z.number(),
  }),
  targetUrl: z
    .string()
    .describe('URL of the running dev server (e.g. http://localhost:5173) the agent will explore'),
  sliceDescription: z
    .string()
    .describe('User-facing description of the scenario the spec must exercise'),
});

const config: SkillConfig = {
  contextSchema: SpecAuthorContextSchema,
  contextAllowlist: [
    'workItem.title',
    'workItem.body',
    'workItem.number',
    'targetUrl',
    'sliceDescription',
  ],
  /**
   * `playwright-mcp` exposes Microsoft's playwright-test MCP server tools
   * (browser_*, planner_*, generator_*). The runtime auto-merges
   * apps/web/.mcp.json into the spawn-time MCP config when this bundle
   * is present (see core/agent-runtime/claude-cli.ts:resolveMcpConfigPath).
   *
   * `read-write` is included so the agent can read existing fixtures and
   * write the spec file under apps/web/e2e/ if the MCP write_test tool
   * declines (defensive — generator_write_test is the primary path).
   */
  toolBundles: ['playwright-mcp', 'read-write'],
  modelPin: 'sonnet',
  freshContext: false,
  role: 'developer',
};

export default config;
