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
} satisfies Record<string, string[]>;

export type BundleName = keyof typeof TOOL_BUNDLES;
