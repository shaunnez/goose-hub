import { createHash } from 'node:crypto';
import { HOLDOUT_ROLES } from '../agent-runtime/roles.js';
import type { Role } from '../types.js';

export type ToolCapability =
  | 'context'
  | 'read'
  | 'write'
  | 'verify'
  | 'git-read'
  | 'qa'
  | 'evidence'
  | 'decision-record'
  | 'native-shell';

export type ToolSurface =
  | { kind: 'mcp'; serverName: string; toolName: string }
  | { kind: 'native'; toolName: string };

export interface ToolDefinition {
  externalName: string;
  surface: ToolSurface;
  capabilities: ReadonlyArray<ToolCapability>;
}

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
  'mcp__factory-tools__repo_intel.query',
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
  'mcp__factory-tools__get_log',
  'mcp__factory-tools__get_blame',
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

export const TOOL_BUNDLE_DEFINITIONS = {
  core: [] as string[],
  read: [...FT_CONTEXT, ...FT_READ, ...FT_GIT_READ],
  'dev-tools': [...FT_CONTEXT, ...FT_READ, ...FT_WRITE, ...FT_VERIFY, ...FT_GIT_READ],
  'qa-tools': [...FT_CONTEXT, ...FT_READ, ...FT_GIT_READ, ...FT_QA],
  validate: [...FT_CONTEXT, ...FT_READ, ...FT_EVIDENCE],
  'decision-record-only': ['record-decision'],
  'emergency-debug': ['Bash'],
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

export type BundleName = keyof typeof TOOL_BUNDLE_DEFINITIONS;

const OPTIONAL_MCP_SERVER_BUNDLES = new Set<BundleName>(['playwright-mcp']);
const HOLDOUT_FORBIDDEN_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'decision-record',
  'native-shell',
]);

const TOOL_DEFINITIONS = new Map<string, ToolDefinition>();

for (const externalName of FT_CONTEXT) {
  defineTool(
    externalName,
    externalName.endsWith('__record_decision') ? ['decision-record'] : ['context'],
  );
}
for (const externalName of FT_READ) defineTool(externalName, ['read']);
for (const externalName of FT_WRITE) defineTool(externalName, ['write']);
for (const externalName of FT_VERIFY) defineTool(externalName, ['verify']);
for (const externalName of FT_GIT_READ) defineTool(externalName, ['git-read']);
for (const externalName of FT_QA) defineTool(externalName, ['qa']);
for (const externalName of FT_EVIDENCE) defineTool(externalName, ['evidence']);
for (const externalName of TOOL_BUNDLE_DEFINITIONS['playwright-mcp']) {
  defineTool(externalName, ['evidence']);
}
defineNativeTool('Bash', ['native-shell']);
defineNativeTool('record-decision', ['decision-record']);

function defineTool(externalName: string, capabilities: ReadonlyArray<ToolCapability>): void {
  TOOL_DEFINITIONS.set(externalName, {
    externalName,
    surface: parseMcpSurface(externalName),
    capabilities,
  });
}

function defineNativeTool(externalName: string, capabilities: ReadonlyArray<ToolCapability>): void {
  TOOL_DEFINITIONS.set(externalName, {
    externalName,
    surface: { kind: 'native', toolName: externalName },
    capabilities,
  });
}

function parseMcpSurface(externalName: string): ToolSurface {
  const match = /^mcp__(.+?)__(.+)$/.exec(externalName);
  if (match == null) {
    return { kind: 'native', toolName: externalName };
  }
  return { kind: 'mcp', serverName: match[1] ?? '', toolName: match[2] ?? '' };
}

export function lookupTool(externalName: string): ToolDefinition {
  return (
    TOOL_DEFINITIONS.get(externalName) ?? {
      externalName,
      surface: parseMcpSurface(externalName),
      capabilities: [],
    }
  );
}

export function bundleTools(bundleName: string): string[] {
  return [...(TOOL_BUNDLE_DEFINITIONS[bundleName as BundleName] ?? [])];
}

export function isOptionalMcpServerBundle(bundleName: string): boolean {
  return OPTIONAL_MCP_SERVER_BUNDLES.has(bundleName as BundleName);
}

export function isToolAllowedForRole(externalName: string, role?: Role): boolean {
  if (role == null || !HOLDOUT_ROLES.has(role)) return true;
  const definition = lookupTool(externalName);
  return !definition.capabilities.some((capability) =>
    HOLDOUT_FORBIDDEN_CAPABILITIES.has(capability),
  );
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
