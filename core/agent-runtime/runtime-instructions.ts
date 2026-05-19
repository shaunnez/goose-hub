export const FACTORY_WORKSPACE_ONLY_INSTRUCTIONS = `## Factory workspace boundary

Factory agents must not read ~/.codex, ~/.agents, ~/.claude, user home memory files, or sibling repos.
All repo exploration must stay under workspaceDir / <worktreePath>.
If prior context is needed, use only context provided by Factory.`;

/**
 * Tool-preference guidance for Phase 6 of ADR 0045. Both surfaces remain
 * in the allowlist during transition — Phase 7 removes the native ones —
 * so this note steers agents to the audited, workspace-bound factory_*
 * tools without breaking skills whose prompts still mention native names.
 */
export const FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS = `## Factory tools

Prefer the \`mcp__factory-tools__*\` tools over native Read / Write / Edit / Glob / Grep / Bash:

- File reads: \`mcp__factory-tools__read_file\`, \`mcp__factory-tools__read_many_files\`, \`mcp__factory-tools__list_dir\`, \`mcp__factory-tools__list_files\`, \`mcp__factory-tools__file_exists\`, \`mcp__factory-tools__file_info\`
- Text search: \`mcp__factory-tools__search_text\` (not \`rg\` via Bash)
- File mutations: \`mcp__factory-tools__write_file\`, \`mcp__factory-tools__edit_file\`, \`mcp__factory-tools__apply_patch\`, \`mcp__factory-tools__create_directory\`, \`mcp__factory-tools__move_file\`, \`mcp__factory-tools__delete_file\`
- Verification: \`mcp__factory-tools__run_tests\`, \`mcp__factory-tools__run_lint\`, \`mcp__factory-tools__run_typecheck\`, \`mcp__factory-tools__run_isolated_test\` (not raw \`pnpm\` invocations)
- Git read-only: \`mcp__factory-tools__get_status\`, \`mcp__factory-tools__get_diff\`, \`mcp__factory-tools__get_changed_files\`, \`mcp__factory-tools__get_head_sha\`, \`mcp__factory-tools__get_merge_base\`
- Project context: \`mcp__factory-tools__get_project_context\`, \`mcp__factory-tools__get_stack_commands\`

All paths are workspace-relative. Absolute paths and \`..\` traversal are rejected. Commands run with \`shell: false\`; no shell strings. Output is byte-capped and timeouts are per-tool. Every call emits a structured \`agent.tool-call\` audit event.

Workflow-owned operations (commit, open PR, transition state, publish evidence) are not in your toolset — the orchestrator drives them.`;

export function withFactoryRuntimeInstructions(systemPrompt: string | undefined): string {
  const prelude = `${FACTORY_WORKSPACE_ONLY_INSTRUCTIONS}\n\n${FACTORY_TOOLS_PREFERENCE_INSTRUCTIONS}`;
  if (systemPrompt == null || systemPrompt.trim().length === 0) {
    return prelude;
  }
  return `${prelude}\n\n${systemPrompt}`;
}
