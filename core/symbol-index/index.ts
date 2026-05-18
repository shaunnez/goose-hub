export type { ImportRow, SymbolKind, SymbolRow } from './types.js';
export { defaultDbPath, openIndexDb } from './db.js';
export { DEFAULT_INCLUDE_DIRS, buildIndex, extractFromSource, walkTsFiles } from './builder.js';
export type { BuildOptions, BuildResult } from './builder.js';
export { assessSymbolIndexFreshness, ensureSymbolIndexFresh } from './freshness.js';
export type {
  EnsureSymbolIndexFreshResult,
  SymbolIndexFreshness,
  SymbolIndexFreshnessOptions,
} from './freshness.js';
export {
  findCallers,
  findCallersOfExport,
  findSymbol,
  listExportsOf,
  listImports,
} from './query.js';
export { extractIdentifiers, lookupWorkItemSymbols } from './lookup.js';
export type { LookupOptions, SymbolHint } from './lookup.js';
