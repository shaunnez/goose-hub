import type { Role } from '../types.js';
import {
  bundleTools,
  isKnownBundleName,
  isKnownToolName,
  isOptionalMcpServerBundle,
  isToolAllowedForRole,
  lookupTool,
  stableHash,
} from './tool-repository.js';

export type ToolBindingSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ToolBindingApprovalPolicy = 'never';

export interface ToolBindingInput {
  toolBundles: ReadonlyArray<string>;
  toolExtras: ReadonlyArray<string>;
  role?: Role;
  skill?: string;
}

export interface ToolBindingFingerprints {
  toolBindingHash: string;
  toolAllowlistHash: string;
  mcpServerSetHash: string;
}

export type ToolBindingWarning =
  | { kind: 'unknown-bundle'; name: string }
  | { kind: 'unknown-tool-extra'; name: string };

export interface ToolBinding {
  allowlist: string[];
  enabledToolsByServer: Record<string, string[]>;
  nativeTools: string[];
  mcpServerBundles: string[];
  mcpServerNames: string[];
  sandboxMode: ToolBindingSandboxMode;
  approvalPolicy?: ToolBindingApprovalPolicy;
  fingerprints: ToolBindingFingerprints;
  warnings: ToolBindingWarning[];
}

const BROWSER_PROCESS_ACCESS_SKILLS = new Set(['playwright-repro', 'evidence-post']);

export function bindToolsForAgentSpec(input: ToolBindingInput): ToolBinding {
  const selectedTools = new Set<string>();
  const mcpServerBundles = new Set<string>();
  const warnings: ToolBindingWarning[] = [];

  for (const bundle of input.toolBundles) {
    if (!isKnownBundleName(bundle)) {
      warnings.push({ kind: 'unknown-bundle', name: bundle });
      continue;
    }
    if (isOptionalMcpServerBundle(bundle)) mcpServerBundles.add(bundle);
    for (const tool of bundleTools(bundle)) {
      addToolIfAllowed(selectedTools, tool, input.role);
    }
  }

  for (const tool of input.toolExtras) {
    if (!isKnownToolName(tool)) {
      warnings.push({ kind: 'unknown-tool-extra', name: tool });
      continue;
    }
    addToolIfAllowed(selectedTools, tool, input.role);
  }

  const allowlist = [...selectedTools].sort();
  const enabledToolsByServer: Record<string, string[]> = {};
  const nativeTools: string[] = [];

  for (const externalName of allowlist) {
    const definition = lookupTool(externalName);
    if (definition.surface.kind === 'mcp') {
      enabledToolsByServer[definition.surface.serverName] ??= [];
      enabledToolsByServer[definition.surface.serverName]?.push(definition.surface.toolName);
    } else {
      nativeTools.push(definition.surface.toolName);
    }
  }

  for (const tools of Object.values(enabledToolsByServer)) {
    tools.sort();
  }
  nativeTools.sort();

  const needsBrowserProcessAccess =
    input.skill != null &&
    BROWSER_PROCESS_ACCESS_SKILLS.has(input.skill) &&
    input.toolBundles.includes('validate');
  const hasWorkspaceWriteTool = allowlist.some((tool) =>
    lookupTool(tool).capabilities.includes('write'),
  );
  const sandboxMode: ToolBindingSandboxMode = needsBrowserProcessAccess
    ? 'danger-full-access'
    : hasWorkspaceWriteTool
      ? 'workspace-write'
      : 'read-only';
  const mcpServerNames = Object.keys(enabledToolsByServer).sort();
  const normalizedMcpServerBundles = [...mcpServerBundles].sort();
  const normalizedBundleNames = [...new Set(input.toolBundles)].sort();

  return {
    allowlist,
    enabledToolsByServer,
    nativeTools,
    mcpServerBundles: normalizedMcpServerBundles,
    mcpServerNames,
    sandboxMode,
    ...(needsBrowserProcessAccess ? { approvalPolicy: 'never' as const } : {}),
    warnings,
    fingerprints: {
      toolAllowlistHash: stableHash(allowlist),
      mcpServerSetHash: stableHash({
        bundles: normalizedMcpServerBundles,
        servers: mcpServerNames,
      }),
      toolBindingHash: stableHash({
        allowlist,
        bundles: normalizedBundleNames,
        extras: [...new Set(input.toolExtras)].sort(),
        mcpServerBundles: normalizedMcpServerBundles,
        nativeTools,
        role: input.role ?? null,
        sandboxMode,
        skill: input.skill ?? null,
      }),
    },
  };
}

function addToolIfAllowed(selectedTools: Set<string>, tool: string, role?: Role): void {
  if (isToolAllowedForRole(tool, role)) {
    selectedTools.add(tool);
  }
}
