// Public compatibility export for existing bundle consumers. The canonical
// definitions live in tool-repository.ts so binding, allowlists, and runtime
// fingerprints share one source.
import { type BundleName, TOOL_BUNDLE_DEFINITIONS } from './tool-repository.js';

export const TOOL_BUNDLES = TOOL_BUNDLE_DEFINITIONS;
export type { BundleName };
