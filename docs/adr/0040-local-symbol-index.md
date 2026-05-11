# ADR 0040 — Local symbol index for code navigation

**Status:** Accepted
**Date:** 2026-05-11

## Context

Goose Hub has grown to 642 TS/TSX files across 26 core packages, 37 slices, 28 skills, and 3 apps. Agents (and humans) repeatedly ask the same kinds of questions when orienting:

- "Where is `<symbol>` defined?"
- "Who imports `<symbol>`?"
- "What does `<file>` export?"
- "Which file holds the Drizzle table `<name>`?"

Today the answers come from:

1. **`grep` / `ripgrep`** — fast but textual; matches comments, strings, and stale references.
2. **Scout skills** (`scout-code-path`, `scout-schema`, `scout-dependency`) — semantic but expensive (an LLM spawn) and recomputed per investigation run.
3. **Hand-maintained docs** — `docs/inventory.md` lists packages/slices/skills (one line each), but says nothing about the symbols inside them.

Three options were considered for closing the gap:

- **(A) Embed code into a vector DB (Pinecone, pgvector, sqlite-vec).** Rejected: violates FACTORY_RULES rule 27 (no new heavyweight dependencies without an ADR), and prior art on TypeScript symbol search shows lexical + structural indexes outperform embeddings for "find by name" questions.
- **(B) Defer to scout skills only.** Rejected: every fresh investigation re-runs scouts to relearn facts the filesystem already knows; the LLM spend is wasted on lookups that should be O(1).
- **(C) Local SQLite symbol index, built from the TypeScript compiler API.** Selected.

## Decision

Add `core/symbol-index/` — a regenerable, local SQLite cache of exports and imports across the repo. No new heavyweight dependencies: the TypeScript compiler is already a devDep; `better-sqlite3` is already a dep.

### Storage

A single SQLite database at `.factory/symbol-index.db` (gitignored). The path stays under `.factory/` so it shares the same "local operational state" semantics as the main DB but in a separate file — the symbol index is a cache, not authoritative.

Schema:

| Table | Columns |
|---|---|
| `files` | `path TEXT PRIMARY KEY, last_indexed_at TEXT NOT NULL` |
| `symbols` | `id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL, exported INTEGER NOT NULL` |
| `imports` | `id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, source_module TEXT NOT NULL, imported_name TEXT NOT NULL` |

`kind` is one of: `function`, `class`, `const`, `interface`, `type`, `enum`, `variable`. Indexes on `(symbols.name)`, `(symbols.file_path)`, `(imports.source_module)`, `(imports.imported_name)` make the four primary queries O(1) lookups.

### Builder

`core/symbol-index/builder.ts` walks the repo (`apps/`, `core/`, `slices/`, `skills/`, `target-projects/`), skipping `node_modules`, `dist`, `.worktrees`, `coverage`, `.factory`. For each `.ts`/`.tsx` file:

1. Parse via `ts.createSourceFile`.
2. Visit top-level declarations; record each named declaration with its line + `exported` flag.
3. Visit import declarations; record `(file_path, source_module, imported_name)` triples.
4. Upsert into SQLite in a single transaction.

The builder is **idempotent and rebuild-from-scratch** — re-running drops file rows for any file whose mtime differs and re-inserts. Cheaper than tracking partial diffs; the full walk is sub-second on the current repo.

### Query API

Exported from `core/symbol-index/index.ts`:

```ts
findSymbol(name: string): SymbolRow[]
findCallers(name: string): string[]              // file paths importing this name
listExportsOf(filePath: string): SymbolRow[]
listImports(filePath: string): ImportRow[]
```

No mutation API is exposed — callers regenerate the index via the build script.

### CLI / pnpm script

`scripts/build-symbol-index.ts` + `pnpm symbol-index` rebuild the index. The script is opt-in (not on the critical path of any workflow) — first usage is documentation/triage; integration into scouts is a future change.

### What this is not

- **Not a replacement for scouts.** Scouts still synthesise facts ("how does X work"); this index answers identity questions ("where is X").
- **Not a runtime dependency.** No workflow or slice blocks on the index being fresh. A stale index returns stale results — callers decide how to react.
- **Not vector / embedding search.** Pure lexical-structural index over the TS compiler AST. FACTORY_RULES rule 27 unchanged.

## Consequences

- **Faster orientation.** "Where does `selectPersona` live?" goes from a scout spawn (~$0.05 + 10s) to a SQLite lookup (~1ms, $0).
- **Quieter scouts.** The Wave-1 scout layer becomes responsible for higher-value synthesis once basic "where is X" is delegated to the index. Concrete migration is out of scope here.
- **One more local artifact to manage.** Adds `.factory/symbol-index.db` to the gitignore; manual `pnpm symbol-index` between sessions if the user wants fresh results. Future work can wire automatic refresh.
- **Locked in: TypeScript-only scope.** The index does not cover `target-projects/<slug>/` target-repos that aren't TS. That's by design — those repos have their own tooling; this index is for the Goose Hub codebase itself.

## Out of scope (deferred)

- Tree-sitter or LSP-based indexing for non-TS target repos.
- Wiring index queries into scout skills as a pre-investigation cache lookup.
- A web UI surface for "where used" queries.
- Watching the filesystem for changes (manual `pnpm symbol-index` for now).
