# core/symbol-index

Local, regenerable SQLite index of every exported symbol and import statement across the Goose Hub codebase. Use it to answer "where is X defined?" / "who imports X?" without an LLM spawn or a `grep`. See ADR 0040 for the rationale.

## Build

```sh
pnpm symbol-index            # writes ~/.factory/symbol-index.db
```

Re-run any time the codebase changes. The build is sub-second and idempotent — files removed since the last run are dropped from the index automatically.

## Files

| File | Exports |
|---|---|
| `db.ts` | `openIndexDb(path?)` — opens (creates) the SQLite cache. `defaultDbPath()`. |
| `builder.ts` | `buildIndex(opts)` — walks `apps/`, `core/`, `slices/`, `skills/` and indexes every `.ts`/`.tsx` file. `extractFromSource(absPath, content)` is the pure per-file extractor exposed for testing. |
| `query.ts` | `findSymbol(db, name)`, `findCallers(db, name)`, `listExportsOf(db, filePath)`, `listImports(db, filePath)`. |
| `types.ts` | `SymbolRow`, `ImportRow`, `SymbolKind`. |
| `index.ts` | Public surface. |

## Query examples

```ts
import { findCallers, findSymbol, openIndexDb } from '@goose-hub/core/symbol-index/index.js';

const db = openIndexDb();

findSymbol(db, 'invokeSkill');
// → [{ filePath: 'core/agent-runtime/invoke-skill.ts', kind: 'function', line: 28, exported: true }]

findCallers(db, 'invokeSkill');
// → ['core/agent-runtime/advisor.ts', 'slices/decompose-prd/workflow.ts', ...]
```

## Schema

| Table | Columns |
|---|---|
| `files` | `path`, `last_indexed_at` |
| `symbols` | `id`, `file_path`, `name`, `kind`, `line`, `exported` |
| `imports` | `id`, `file_path`, `source_module`, `imported_name` |

Indexes on `symbols.name`, `symbols.file_path`, `imports.source_module`, `imports.imported_name`, `imports.file_path` keep all four query functions O(1) on lookup.

## What this is not

- Not vector / embedding search. Lexical-structural index over the TypeScript compiler AST. FACTORY_RULES rule 27 unchanged.
- Not authoritative. The index is a cache; the filesystem is the source of truth. A stale index returns stale rows — callers regenerate as needed.
- Not a runtime dependency. No workflow blocks on the index being fresh. Manual `pnpm symbol-index` for now; automatic refresh is future work.
- Not cross-repo. The index covers Goose Hub itself, not the target repos under `target-projects/<slug>/`.
