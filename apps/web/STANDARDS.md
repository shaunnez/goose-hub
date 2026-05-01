# Web Frontend Standards

> Claude: read this before touching any file in `apps/web/src/`.

## Feature Folder Structure

Every feature folder (`chrome/`, `detail/`, `board/`, `inbox/`) MUST use:

```
feature/
  components/   ← React components (.tsx only)
  lib/          ← TypeScript utilities specific to this feature (.ts only)
  slice.test.ts ← Required by FACTORY_RULES; tests public slice behaviour
```

Exception: `chrome/slots/` is a chrome-specific subfolder for shell injection points.
This pattern does **not** generalise to other features.

## Shared Layer (`lib/`)

Top-level `apps/web/src/lib/` is the cross-feature shared layer.

**Rule:** if a symbol is used by 2+ feature folders, it belongs in `lib/`. Never duplicate it.

| File | Contents |
|------|----------|
| `lib/api.ts` | All async API functions (`fetch*`, `add*`, `set*`, `transition*`) |
| `lib/types.ts` | All DTOs and TS interfaces (`WorkItemDto`, `ProjectSummary`, etc.) |
| `lib/constants.ts` | Label/color/state maps (`STATE_LABEL`, `PRIORITY_*`, `GATE_STATES`) |
| `lib/utils.ts` | Pure functions (`timeAgo`, `ageLabel`, `truncate`) |
| `lib/cn.ts` | `cn()` className helper |
| `lib/markdown.ts` | `renderMarkdownToHtml()` |
| `lib/transitions.ts` | `LEGAL_TARGETS` transition table |
| `lib/lanes.config.ts` | Lane config and `sortLaneItems()` |

## Shared UI (`components/ui/`)

Leaf components with no feature-specific state or API calls belong in `components/ui/`.

**Examples:** `Button`, `Pill`, `MarkdownEditor`.

**Promote here if:** a component is used by 2+ feature folders AND has no feature-specific deps.

## Naming Conventions

| Concept | Name pattern | Example |
|---------|-------------|---------|
| Detail page section | `*Section.tsx` | `OverviewSection.tsx` |
| Chrome injection point | `*Slot.tsx` | `ProjectSwitcherSlot.tsx` |

**Slots are chrome-only.** Do not use `*Slot` naming outside `chrome/slots/`.

## Import Rules

- Feature components import shared code from `@/lib/*` or `@/components/ui/*`.
- Types are imported from `@/lib/types` — never from `@/lib/api` for type-only imports.
- Feature components **never** import from other feature folders.
- Cross-feature imports are architecture violations.

## Test Coverage Requirements

| What | Where | Command |
|------|-------|---------|
| Every slice | `feature/slice.test.ts` | `pnpm test` |
| Util functions | `lib/utils.test.ts` | `pnpm test` |
| Constants completeness | `lib/constants.test.ts` | `pnpm test` |
| Component rendering | `feature/components/*.test.tsx` | `pnpm test` |
| Golden path (active milestone) | `e2e/happy-path.spec.ts` | `pnpm test:e2e` |

Component test files use `/** @vitest-environment jsdom */` at the top — no global config needed.

## Adding a New Constant or Utility

1. Is it used by 2+ features? → `lib/constants.ts` or `lib/utils.ts` + update tests.
2. Is it feature-specific? → `feature/lib/filename.ts`.
3. Never define the same map twice. Grep before adding.
