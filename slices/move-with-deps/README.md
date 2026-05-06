# slices/move-with-deps

M11.06: Move-with-dependencies CLI and UI confirmation.

## What this slice does

Moves an issue to `schedule:current`, optionally pulling its open dependencies along.

Core logic lives in `core/projects/move-with-deps.ts`. The slice is intentionally pure — all I/O is injected so it is unit-testable without hitting GitHub.

## Surfaces touched

| Surface | Change |
|---------|--------|
| `core/projects/move-with-deps.ts` | New: `moveIssueToCurrent()`, types |
| `apps/cli/src/index.ts` | New `goose task move` command |
| `apps/web/…/MoveToCurrentDialog.tsx` | New: dep-aware confirmation dialog |
| `apps/web/…/TaskHeader.tsx` | Intercepts schedule→current selection |

## CLI usage

```sh
goose task move <project-slug> <issue-id> --to=current --with-dependencies
goose task move <project-slug> <issue-id> --to=current --ignore-dependencies
```

Without either flag, the CLI errors when open dependencies exist, requiring an explicit choice.

## UI behaviour

When the user selects `schedule:current` on an issue that has `Depends on` entries:

1. A dialog opens listing open dependencies with checkboxes (all checked by default).
2. The user can uncheck deps they do not want to move.
3. If all deps are already closed or in `schedule:current`, the dialog is skipped and the issue moves immediately.

## Tests

```sh
pnpm vitest run slices/move-with-deps/slice.test.ts
```
