import type { Role } from '../types.js';
import { TOOL_BUNDLES } from './bundles.js';
import { bindToolsForAgentSpec } from './tool-binding.js';

export { TOOL_BUNDLES };

interface AllowlistSpec {
  toolBundles: string[];
  toolExtras: string[];
  /** When provided, holdout-blocked bundles are stripped for holdout roles. */
  role?: Role;
}

export function computeAllowlist(spec: AllowlistSpec): string[] {
  return bindToolsForAgentSpec(spec).allowlist;
}
