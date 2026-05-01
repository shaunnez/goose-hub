export const TOOL_BUNDLES = {
  'read-only': ['Read', 'Glob', 'Grep', 'Bash(cat *)', 'Bash(ls *)'],
  'read-write': ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  'bash-restricted': ['Bash'],
} satisfies Record<string, string[]>;

export type BundleName = keyof typeof TOOL_BUNDLES;
