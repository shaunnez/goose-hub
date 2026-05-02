export const TOOL_BUNDLES = {
  'read-only': ['Read', 'Glob', 'Grep', 'Bash(cat *)', 'Bash(ls *)'],
  'read-write': ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  'bash-restricted': ['Bash'],
  /**
   * Sandboxed read bundle for investigator agents.
   * Uses workspace-sandboxed `read` and `search` tools (no raw filesystem access).
   * `work-item-read` is the work-item query tool.
   */
  read: ['read', 'search', 'work-item-read'],
  /**
   * Sandboxed developer bundle. Superset of `read` plus `write`, `bash`, `test`.
   * The lowercase names map to the in-process implementations under
   * `core/tool-layer/tools/`, all enforcing workspace-bound paths and the
   * bash denylist (FACTORY_RULES rules 29, 31, 32).
   */
  'dev-tools': ['read', 'search', 'work-item-read', 'write', 'bash', 'test'],
  /**
   * Playwright validation bundle. Used by skills that run e2e specs and
   * commit/push evidence artefacts (skills/playwright-repro, skills/evidence-post).
   * Bash patterns scoped to test invocation, evidence I/O, and git push of evidence.
   */
  validate: [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash(pnpm test:e2e*)',
    'Bash(pnpm --filter @goose-hub/web test:e2e*)',
    'Bash(pnpm --filter @goose-hub/web exec playwright*)',
    'Bash(npx playwright*)',
    'Bash(mkdir -p evidence/*)',
    'Bash(git add evidence/*)',
    'Bash(git commit -m *)',
    'Bash(git push*)',
    'Bash(git rev-parse HEAD)',
  ],
  /**
   * Playwright-test MCP bundle. Tool list extracted from Microsoft's
   * apps/web/.claude/agents/playwright-test-{planner,generator}.md.
   *
   * When this bundle is on a skill, the runtime merges apps/web/.mcp.json into
   * the spawn-time MCP config so the `playwright-test` server is reachable
   * inside the subprocess (see core/agent-runtime/claude-cli.ts).
   */
  'playwright-mcp': [
    'mcp__playwright-test__browser_click',
    'mcp__playwright-test__browser_close',
    'mcp__playwright-test__browser_console_messages',
    'mcp__playwright-test__browser_drag',
    'mcp__playwright-test__browser_evaluate',
    'mcp__playwright-test__browser_file_upload',
    'mcp__playwright-test__browser_handle_dialog',
    'mcp__playwright-test__browser_hover',
    'mcp__playwright-test__browser_navigate',
    'mcp__playwright-test__browser_navigate_back',
    'mcp__playwright-test__browser_network_requests',
    'mcp__playwright-test__browser_press_key',
    'mcp__playwright-test__browser_run_code',
    'mcp__playwright-test__browser_select_option',
    'mcp__playwright-test__browser_snapshot',
    'mcp__playwright-test__browser_take_screenshot',
    'mcp__playwright-test__browser_type',
    'mcp__playwright-test__browser_wait_for',
    'mcp__playwright-test__browser_verify_element_visible',
    'mcp__playwright-test__browser_verify_list_visible',
    'mcp__playwright-test__browser_verify_text_visible',
    'mcp__playwright-test__browser_verify_value',
    'mcp__playwright-test__planner_setup_page',
    'mcp__playwright-test__planner_save_plan',
    'mcp__playwright-test__generator_read_log',
    'mcp__playwright-test__generator_setup_page',
    'mcp__playwright-test__generator_write_test',
  ],
} satisfies Record<string, string[]>;

export type BundleName = keyof typeof TOOL_BUNDLES;
