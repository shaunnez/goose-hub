import { HOLDOUT_ROLES } from '../agent-runtime/roles.js';
import type { Role } from '../types.js';
import { type BundleName, TOOL_BUNDLES } from './bundles.js';

export { TOOL_BUNDLES };

/**
 * Bundles that holdout roles (qa, reviewer) are forbidden from receiving.
 * These bundles can leak decision-summary state from the implementation phase,
 * violating the holdout discipline (FACTORY_RULES rule 1).
 */
const HOLDOUT_BLOCKED_BUNDLES = new Set<BundleName>(['decision-record-only']);

interface AllowlistSpec {
  toolBundles: string[];
  toolExtras: string[];
  /** When provided, holdout-blocked bundles are stripped for holdout roles. */
  role?: Role;
}

export function computeAllowlist(spec: AllowlistSpec): string[] {
  const tools: string[] = [];
  for (const bundle of spec.toolBundles) {
    if (
      spec.role != null &&
      HOLDOUT_ROLES.has(spec.role) &&
      HOLDOUT_BLOCKED_BUNDLES.has(bundle as BundleName)
    ) {
      continue;
    }
    const bundleTools = TOOL_BUNDLES[bundle as BundleName];
    if (bundleTools != null) {
      tools.push(...bundleTools);
    }
  }
  tools.push(...spec.toolExtras);
  return [...new Set(tools)];
}
