export const TOOL_BUNDLES = {
  /**
   * No-tool bundle for skills that receive all context via prompt injection
   * (e.g. grill-me). Declaring this bundle signals intent to restrict tools;
   * the runtime passes --allowedTools '' to the CLI, locking the agent to
   * zero filesystem/shell access.
   */
  core: [] as string[],
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
   * Developer bundle for the fix-issue agent. Uses Claude's native built-in tools.
   * The MCP sandboxed tool server (core/tool-layer/tools/) is not yet wired up;
   * workspace-level deny rules in sandbox.ts provide the safety boundary instead.
   */
  'dev-tools': ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  /**
   * Shell bundle: read-only bash access for skills that need to run commands
   * but must not write files. Covers two use cases:
   *   1. QA/audit: pnpm test/lint commands (same as qa-tools bash patterns)
   *   2. code-quality-audit: git log/blame for Gall's Law evolution analysis (Cat 7)
   * No Read/Glob/Grep — pair with 'read' bundle when file access is also needed.
   */
  shell: [
    'Bash(pnpm test*)',
    'Bash(pnpm --filter*)',
    'Bash(pnpm biome*)',
    'Bash(pnpm typecheck*)',
    'Bash(pnpm lint*)',
    'Bash(git log*)',
    'Bash(git blame*)',
    'Bash(git diff*)',
    'Bash(git show*)',
  ],
  /**
   * QA holdout bundle. Read-only access plus scoped bash for running test/lint
   * commands inside the dev worktree. No Write/Edit — QA must not modify files.
   */
  'qa-tools': [
    'Read',
    'Glob',
    'Grep',
    'Bash(pnpm test*)',
    'Bash(pnpm --filter*)',
    'Bash(pnpm biome*)',
    'Bash(pnpm typecheck*)',
    'Bash(pnpm lint*)',
  ],
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
    'Bash(ffmpeg*)',
    'Bash(mkdir -p evidence/*)',
    'Bash(mkdir -p /tmp/evidence-*)',
    'Bash(cp *)',
    'Bash(git add evidence/*)',
    'Bash(git checkout*)',
    'Bash(git commit -m *)',
    'Bash(git fetch origin evidence/*)',
    'Bash(git push*)',
    'Bash(git rev-parse HEAD)',
    'Bash(git show-ref*)',
    'Bash(git worktree*)',
    'Bash(git -C /tmp/evidence-* add evidence/*)',
    'Bash(git -C /tmp/evidence-* commit -m *)',
    'Bash(git -C /tmp/evidence-* push*)',
    'Bash(git -C /tmp/evidence-* rev-parse HEAD)',
    'Bash(gh issue comment*)',
  ],
  /**
   * M19.06 — record-decision tool (opt-in, feature-flagged).
   * Exposes a single mid-run MCP tool that writes DecisionRecords to SQLite.
   * MUST NOT be granted to holdout roles (qa, reviewer) — enforced by
   * computeAllowlist when `role` is provided.
   */
  'decision-record-only': ['record-decision'],
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
