# ADR 0049: Treesitter AST queries and route index

- Status: Accepted
- Date: 2026-05-23

## Context

`repo_intel.query` now centralizes agent retrieval, but the symbol index only answers export/import-oriented questions. Agents still fall back to broad text search for structural questions such as "where is this hook called with an empty dependency array" or "where is this JSX component rendered with a specific prop". Frontend work also needs route/component context without asking agents to crawl router files manually.

Treesitter-style AST queries are a heavier dependency class than the existing TypeScript compiler symbol scan, so the dependency and cache behavior need an ADR before adding route/component lookup intents.

## Decision

Add a route/component index under `core/route-index/` and extend the repository-intelligence surface with AST-shaped TypeScript/TSX query helpers.

Supported languages are TypeScript and TSX only. The initial implementation uses the TypeScript parser already present in the repo to provide the same structural AST guarantees without adding native parser installation risk to the current stack. If a future change needs language coverage or query expressiveness that the TypeScript parser cannot provide, this ADR is the place to revisit adding native `tree-sitter` and `tree-sitter-typescript` packages.

The route index is a regenerable SQLite cache at `~/.factory/route-index.db`, parallel to the symbol index. `pnpm route-index` performs a rebuild, and `pnpm route refresh` is an alias for the same operation. Staleness is detected by comparing indexed file timestamps with files under `apps/web/src`; stale indexes trigger a non-blocking rebuild attempt before lookups.

AST/route lookup failure modes are non-fatal. Parse failures, stale indexes, or missing generated DBs return typed `index-stale` results through `repo_intel.query` with a `search_text` fallback hint. Agents should treat these responses as guidance to use narrower text search, not as workflow errors.

## Consequences

- Agents get audited, cacheable intents for structural code questions without shell access or route crawling.
- The index remains local and regenerable; SQLite contents are never source of truth.
- TypeScript/TSX are the only supported AST languages for now.
- Route and AST lookup results inherit #995 per-run `repo_intel.query` caching because they are dispatched through the same tool.
