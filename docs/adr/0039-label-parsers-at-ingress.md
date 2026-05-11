# ADR 0039 — Validate label values at ingress, trust the type downstream

**Status:** Accepted
**Date:** 2026-05-11

## Context

A code-quality scan flagged ~1,300 string-literal references to state names
and ~1,000 references to priority/role/work-item-type values across the
codebase. The labels are GitHub label names (`factory:done`, `priority:high`,
`type:feature`, etc.) — strings on the wire, but with strict, well-known
domains.

Two recurring patterns made this a problem rather than just verbose code:

1. **Untyped fallback ladders.** Every label-mapping site (notably
   `mapIssueToWorkItem` in `core/state-source/github-labels.ts`) re-asserted
   the value space inline — long `value === 'critical' || value === 'high'
   || ... ? value : 'medium'` ladders. The fallback default (`'medium'`,
   `'supervised'`, `'later'`, `'parallel'`, etc.) was a bare literal next to
   the ladder, easy to drift from the intended default.
2. **No central validator.** New consumers manually re-implemented the same
   narrowing predicate, sometimes with a slightly different default. There
   was no obvious single function to import.

Auditing 80+ files of state-name string literals or 35+ files of
priority/type literals one-by-one is the wrong order of magnitude for the
problem. The literals themselves aren't the bug — the bug is that nothing
narrowed the strings to typed enums *at the seam between GitHub and core*.

## Decision

Validate label values at one ingress (`core/state-source/`); trust the
TypeScript type system downstream.

**New module:** `core/state-source/label-parsers.ts`. Exports:

- `LABEL_GROUPS` — constant map of group prefixes (`'priority:'`, `'type:'`,
  `'schedule:'`, `'mode:'`, `'exec:'`, `'factory:'`). Replaces ad-hoc
  template literals like `` `${group}:` ``.
- `parseState(raw)` — strict, returns `StateName | null`. Used at ingress to
  surface unknown state labels rather than silently coercing.
- `parsePriority`, `parseMode`, `parseSchedule`, `parseExec`,
  `parseWorkItemType` — narrow the bare value of `<group>:<value>` to the
  typed enum, falling back to the documented `DEFAULT_*` constant on
  unknown input. Defaults live in `core/state-source/interface.ts`
  (`DEFAULT_PRIORITY`, `DEFAULT_MODE`, …) so changing one is a single edit.
- `parseRole(raw)` — strict, returns `Role | null`. Used by callers that
  ingest persona/role names from external systems (DB rows, persona files).
- `extractLabelValue(labelNames, prefix)` — small helper that codifies the
  `labels.find(...).slice(prefix.length)` pattern.

**`mapIssueToWorkItem`** in `github-labels.ts` is rewritten to use these
parsers. Five inline ladders collapse to five calls. Default values are no
longer co-located with the narrowing logic — they come from
`interface.ts`.

**Defaults moved out of github-labels.ts:**

| Group     | Default       | Symbol               |
|-----------|---------------|----------------------|
| Type      | `feature`     | `DEFAULT_WORK_ITEM_TYPE` |
| Priority  | `medium`      | `DEFAULT_PRIORITY`   |
| Mode      | `supervised`  | `DEFAULT_MODE`       |
| Schedule  | `later`       | `DEFAULT_SCHEDULE`   |
| Exec      | `parallel`    | `DEFAULT_EXEC`       |

## What this is NOT

- **Not a sweep of all 1,300 state-literal callsites.** Those callsites
  already work — they hand a known-good string to other code that's already
  typed as `StateName`. Auditing them adds no safety because the values are
  already constrained by the type system at every consumption point. Future
  drift will be caught by the parser at the next ingress, not by a manual
  audit of historical code.
- **Not a Zod migration.** The discriminated-union approach inside
  `ReviewOutputSchema` and `RetroOutputSchema` already uses Zod where
  validation needs to be runtime-enforceable. Label parsing is a tighter,
  cheaper case (single-key lookup against a small `Set`); a Zod schema would
  add weight without buying anything.
- **Not a generalised label registry.** The label namespace is small and
  static. If/when projects need custom label groups, that's a separate ADR.

## Consequences

- New consumers that touch label values are expected to import from
  `label-parsers.ts` rather than re-asserting the value space inline.
- Default values for missing labels are now named constants — adding a new
  group means one place to change instead of three (interface, ingress,
  ad-hoc fallback).
- If GitHub's label namespace ever grows a value the parser doesn't know
  (e.g. a new priority `urgent`), `mapIssueToWorkItem` returns the default
  rather than crashing. Callers that need strict failure should use
  `parseState(...) ?? throw …` or an equivalent at their own seam.
