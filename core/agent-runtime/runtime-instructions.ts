export const FACTORY_WORKSPACE_ONLY_INSTRUCTIONS = `## Factory workspace boundary

Factory agents must not read ~/.codex, ~/.agents, ~/.claude, user home memory files, or sibling repos.
All repo exploration must stay under workspaceDir / <worktreePath>.
If prior context is needed, use only context provided by Factory.`;

export function withFactoryRuntimeInstructions(systemPrompt: string | undefined): string {
  if (systemPrompt == null || systemPrompt.trim().length === 0) {
    return FACTORY_WORKSPACE_ONLY_INSTRUCTIONS;
  }
  return `${FACTORY_WORKSPACE_ONLY_INSTRUCTIONS}\n\n${systemPrompt}`;
}
