// factory-tools MCP tools per ADR 0045. Names match `FACTORY_TOOL_NAMES`
// in core/tool-layer/mcp/schemas.ts; the runtime adds the
// `mcp__factory-tools__` prefix when building the CLI allowlist. Listed
// directly here as full names so the bundle audit is greppable.
const FT_CONTEXT = [
  'mcp__factory-tools__get_project_context',
  'mcp__factory-tools__get_stack_commands',
  'mcp__factory-tools__get_work_item',
  'mcp__factory-tools__record_decision',
];
const FT_READ = [
  'mcp__factory-tools__read_file',
  'mcp__factory-tools__read_many_files',
  'mcp__factory-tools__list_dir',
  'mcp__factory-tools__list_files',
  'mcp__factory-tools__search_text',
  'mcp__factory-tools__file_exists',
  'mcp__factory-tools__file_info',
];
const FT_WRITE = [
  'mcp__factory-tools__write_file',
  'mcp__factory-tools__edit_file',
  'mcp__factory-tools__apply_patch',
  'mcp__factory-tools__create_directory',
  'mcp__factory-tools__move_file',
  'mcp__factory-tools__delete_file',
];
const FT_VERIFY = [
  'mcp__factory-tools__run_tests',
  'mcp__factory-tools__run_lint',
  'mcp__factory-tools__run_typecheck',
  'mcp__factory-tools__run_package_script',
  'mcp__factory-tools__run_targeted_command',
];
const FT_GIT_READ = [
  'mcp__factory-tools__get_status',
  'mcp__factory-tools__get_changed_files',
  'mcp__factory-tools__get_diff',
  'mcp__factory-tools__get_head_sha',
  'mcp__factory-tools__get_merge_base',
];
const FT_QA = [
  'mcp__factory-tools__get_pr_diff',
  'mcp__factory-tools__run_full_suite_if_needed',
  'mcp__factory-tools__run_isolated_test',
  'mcp__factory-tools__get_verification_summary',
  'mcp__factory-tools__check_acceptance_criteria',
];
const FT_EVIDENCE = [
  'mcp__factory-tools__get_app_url',
  'mcp__factory-tools__write_playwright_spec',
  'mcp__factory-tools__run_playwright_spec',
  'mcp__factory-tools__collect_evidence',
];

export const TOOL_BUNDLES = {
  /**
   * No-tool bundle for skills that receive all context via prompt injection
   * (e.g. grill-me). Declaring this bundle signals intent to restrict tools;
   * the runtime passes --allowedTools '' to the CLI, locking the agent to
   * zero filesystem/shell access.
   */
  core: [] as string[],
  /**
   * Read bundle for investigator agents (scouts, grill-and-prd, dev-review,
   * etc.). Pure factory-tools (ADR 0045 Phase 5b — native cutover). Context
   * + workspace-bound read/search/list, plus read-only git so the agent can
   * compute diffs without invoking `git` via Bash.
   */
  read: [...FT_CONTEXT, ...FT_READ, ...FT_GIT_READ],
  /**
   * Developer bundle for the fix-issue / implement agents. Pure
   * factory-tools — no native Read / Write / Edit / Glob / Grep / Bash.
   * Write + verify + git-read in addition to read/context; record_decision
   * lives in context.
   */
  'dev-tools': [...FT_CONTEXT, ...FT_READ, ...FT_WRITE, ...FT_VERIFY, ...FT_GIT_READ],
  /**
   * Shell bundle: read-only bash access for skills that need to run commands
   * QA holdout bundle. Pure factory-tools (ADR 0045 Phase 5b). Context +
   * read/search + git/diff (for PR diff inspection) + qa family
   * (get_pr_diff, run_full_suite_if_needed, run_isolated_test,
   * get_verification_summary, check_acceptance_criteria). No write tools.
   */
  'qa-tools': [...FT_CONTEXT, ...FT_READ, ...FT_GIT_READ, ...FT_QA],
  /**
   * Playwright validation bundle. Used by skills that run e2e specs and
   * Playwright validation bundle for skills that run e2e specs and produce
   * evidence artefacts (skills/playwright-repro, skills/evidence-post). Pure
   * factory-tools (ADR 0045 Phase 5b). Evidence family covers spec write,
   * spec run, evidence collection. Workflow drives the commit/push of
   * evidence packets via tools/workflow.ts (not in this bundle — never
   * granted to agents).
   *
   * Skill mix continues to use 'validate' for playwright-test MCP browser
   * tools too via the playwright-mcp bundle.
   */
  validate: [...FT_CONTEXT, ...FT_READ, ...FT_EVIDENCE],
  /**
   * M19.06 — record-decision tool (opt-in, feature-flagged).
   * Exposes a single mid-run MCP tool that writes DecisionRecords to SQLite.
   * MUST NOT be granted to holdout roles (qa, reviewer) — enforced by
   * computeAllowlist when `role` is provided.
   */
  'decision-record-only': ['record-decision'],
  /**
   * Emergency-debug bundle (ADR 0045 Phase 7). Native Bash for incident
   * response only. No skill should declare this bundle by default; the
   * project config must intentionally opt in by listing it in
   * `agentConfig.bundleOverrides` (or equivalent project surface) for a
   * specific debug session. Holdout discipline still applies — never grant
   * to qa / reviewer.
   */
  'emergency-debug': ['Bash'],
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
