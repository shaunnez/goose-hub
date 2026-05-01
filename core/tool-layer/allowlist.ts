import { TOOL_BUNDLES, type BundleName } from './bundles.js';

export { TOOL_BUNDLES };

interface AllowlistSpec {
  toolBundles: string[];
  toolExtras: string[];
}

export function computeAllowlist(spec: AllowlistSpec): string[] {
  const tools: string[] = [];
  for (const bundle of spec.toolBundles) {
    const bundleTools = TOOL_BUNDLES[bundle as BundleName];
    if (bundleTools != null) {
      tools.push(...bundleTools);
    }
  }
  tools.push(...spec.toolExtras);
  return [...new Set(tools)];
}
