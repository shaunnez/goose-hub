# Route Index

Regenerable SQLite index for frontend routes and JSX component usages.

- Build with `pnpm route-index`.
- Query with `pnpm route find <path-pattern>`, `pnpm route component <name>`, or `pnpm route route-for-component <name>`.
- Default DB path: `~/.factory/route-index.db`.

The index is a cache. Source files remain authoritative, and stale/missing indexes should fall back to narrower repo search.
