export const FACTORY_WORKSPACE_ONLY_INSTRUCTIONS = `## Factory workspace boundary

Factory agents must not read ~/.codex, ~/.agents, ~/.claude, user home memory files, or sibling repos.
All repo exploration must stay inside the workspace already configured for your tools.
If prior context is needed, use only context provided by Factory.`;

/**
 * Tool-preference guidance for Phase 6 of ADR 0045. Both surfaces remain
 * in the allowlist during transition — Phase 7 removes the native ones —
 * so this note steers agents to the audited, workspace-bound factory_*
 * tools without breaking skills whose prompts still mention native names.
 *
 * Claude variant: tools surface as `mcp__factory-tools__<name>` because
 * the Claude CLI namespaces every MCP tool with its server prefix.
 */
export const FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS = `## Factory tools

Prefer the \`mcp__factory-tools__*\` tools over native Read / Write / Edit / Glob / Grep / Bash:

- File reads: \`mcp__factory-tools__read_file\`, \`mcp__factory-tools__read_many_files\`, \`mcp__factory-tools__list_dir\`, \`mcp__factory-tools__list_files\`, \`mcp__factory-tools__file_exists\`, \`mcp__factory-tools__file_info\`
- Text search: \`mcp__factory-tools__search_text\` (not \`rg\` via Bash)
- File mutations: \`mcp__factory-tools__write_file\`, \`mcp__factory-tools__edit_file\`, \`mcp__factory-tools__apply_patch\`, \`mcp__factory-tools__create_directory\`, \`mcp__factory-tools__move_file\`, \`mcp__factory-tools__delete_file\`
- Verification: \`mcp__factory-tools__run_tests\`, \`mcp__factory-tools__run_lint\`, \`mcp__factory-tools__run_typecheck\`, \`mcp__factory-tools__run_isolated_test\` (not raw \`pnpm\` invocations)
- Git read-only: \`mcp__factory-tools__get_status\`, \`mcp__factory-tools__get_diff\`, \`mcp__factory-tools__get_changed_files\`, \`mcp__factory-tools__get_head_sha\`, \`mcp__factory-tools__get_merge_base\`
- Project context: \`mcp__factory-tools__get_project_context\`, \`mcp__factory-tools__get_stack_commands\`
- Repository intelligence: \`mcp__factory-tools__repo_intel_query\`

The Factory MCP tools are already exposed in this run. Do not use ToolSearch or any tool-discovery surface to find them; call the listed Factory tool names directly. If a direct Factory tool call reports that the tool does not exist, return valid low-confidence JSON naming the exact missing tool; do not fall back to ToolSearch, Bash, resources, or native file tools.

All paths are workspace-relative. Absolute paths and \`..\` traversal are rejected. Commands run with \`shell: false\`; no shell strings. Output is byte-capped and timeouts are per-tool. Every call emits a structured \`agent.tool-call\` audit event.

Do not use MCP resource surfaces or delegation surfaces unless this run explicitly allows them. Forbidden surfaces include \`resources/list\`, \`resources/read\`, \`file://...\` resource handles, collab tools, fork/full-history fork, spawn, and subagent delegation. File access must go through the exposed Factory tools such as \`mcp__factory-tools__read_file\`, \`mcp__factory-tools__list_dir\`, \`mcp__factory-tools__list_files\`, and \`mcp__factory-tools__search_text\`.

Failures from \`resources/list\` or \`resources/templates/list\` are advisory startup/resource-probe noise. They are not evidence that Factory tools such as \`mcp__factory-tools__read_file\`, \`mcp__factory-tools__search_text\`, \`mcp__factory-tools__list_dir\`, or \`mcp__factory-tools__repo_intel_query\` are unavailable.

Workflow-owned operations (commit, open PR, transition state, publish evidence) are not in your toolset — the orchestrator drives them.`;

/**
 * Codex variant. The Codex CLI exposes MCP tools by their server-local
 * name (e.g. `list_dir`, `read_file`), not the Claude-style
 * `mcp__factory-tools__<name>` form. The PreToolUse hook and run-allowlist
 * still record / enforce the prefixed names internally — this string only
 * controls what the agent sees in its prompt.
 */
export const FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX = `## Factory tools

Use the Factory MCP tools exposed by the \`factory-tools\` MCP server. Do not use native shell or file primitives unless this run explicitly allows \`Bash\`.

- File reads: \`read_file\`, \`read_many_files\`, \`list_dir\`, \`list_files\`, \`file_exists\`, \`file_info\`
- Text search: \`search_text\` (not \`rg\` via shell)
- File mutations: \`write_file\`, \`edit_file\`, \`apply_patch\`, \`create_directory\`, \`move_file\`, \`delete_file\`
- Verification: \`run_tests\`, \`run_lint\`, \`run_typecheck\`, \`run_isolated_test\` (not raw \`pnpm\` invocations)
- Git read-only: \`get_status\`, \`get_diff\`, \`get_changed_files\`, \`get_head_sha\`, \`get_merge_base\`
- Project context: \`get_project_context\`, \`get_stack_commands\`
- Repository intelligence: \`repo_intel.query\`

The Factory MCP tools are already exposed in this run. Do not use ToolSearch or any tool-discovery surface to find them; call the listed Factory tool names directly. If a direct Factory tool call reports that the tool does not exist, return valid low-confidence JSON naming the exact missing tool; do not fall back to ToolSearch, Bash, resources, or native file tools.

All paths are workspace-relative. Absolute paths and \`..\` traversal are rejected. Commands run with \`shell: false\`; no shell strings. Output is byte-capped and timeouts are per-tool. Every call emits a structured \`agent.tool-call\` audit event.

Do not use MCP resource surfaces or delegation surfaces unless this run explicitly allows them. Forbidden surfaces include \`resources/list\`, \`resources/read\`, \`file://...\` resource handles, collab tools, fork/full-history fork, spawn, and subagent delegation. File access must go through the exposed Factory tools such as \`read_file\`, \`list_dir\`, \`list_files\`, and \`search_text\`.

Failures from \`resources/list\` or \`resources/templates/list\` are advisory startup/resource-probe noise. They are not evidence that Factory tools such as \`read_file\`, \`search_text\`, \`list_dir\`, or \`repo_intel.query\` are unavailable.

Workflow-owned operations (commit, open PR, transition state, publish evidence) are not in your toolset — the orchestrator drives them.`;

export const FACTORY_READ_DISCIPLINE_INSTRUCTIONS = `## Read discipline

Treat provided context and prior reports as primary evidence.
Do not restart discovery unless the reports contradict each other or lack the file needed for your schema.
Before using tools, decide the exact question the tool call will answer.
Do not read the same file twice unless the first result was truncated; name the missing section before rereading.
For scout and Wave runs, prefer valid partial JSON plus OPEN_QUESTION over extra exploration.`;

export type AgentRuntimeKind = 'claude-cli' | 'codex-cli';

export function factoryToolsPreferenceFor(runtime: AgentRuntimeKind): string {
  return runtime === 'codex-cli'
    ? FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS_CODEX
    : FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS;
}

export function withFactoryRuntimeInstructions(
  systemPrompt: string | undefined,
  opts: { runtime?: AgentRuntimeKind } = {},
): string {
  const toolsPreference = factoryToolsPreferenceFor(opts.runtime ?? 'claude-cli');
  const prelude = `${FACTORY_WORKSPACE_ONLY_INSTRUCTIONS}\n\n${toolsPreference}\n\n${FACTORY_READ_DISCIPLINE_INSTRUCTIONS}`;
  if (systemPrompt == null || systemPrompt.trim().length === 0) {
    return prelude;
  }
  return `${prelude}\n\n${systemPrompt}`;
}
