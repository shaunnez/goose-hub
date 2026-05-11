export type { ImportRow, SymbolKind, SymbolRow } from './types.js';
export { defaultDbPath, openIndexDb } from './db.js';
export { buildIndex, extractFromSource } from './builder.js';
export type { BuildOptions, BuildResult } from './builder.js';
export { findCallers, findSymbol, listExportsOf, listImports } from './query.js';
export { extractIdentifiers, lookupWorkItemSymbols } from './lookup.js';
export type { LookupOptions, SymbolHint } from './lookup.js';
