# ADR 0005 — UI design system: Harness 2.1 adoption

Status: accepted
Date: 2026-04-30
Closes part of: #28 (M2.03)
Related: docs/m2-imp-plan/m2-imp-plan.md

## Context

M2 ships the first operable UI. We have a hi-fi design (Harness 2.1, Claude Design bundle ID `019dd736-729a-7894-94e2-b1c75a3bfc4b`) that maps almost 1:1 onto Goose Hub's UI surface set in `docs/PLAN.md` §21 + §31. The alternative is to invent a system from scratch, but the Harness design has already validated the chrome, kanban, task detail, and density.

## Decision

Adopt the Harness 2.1 design as the visual / IA contract for Goose Hub's UI, with these scope adjustments for M2:

1. **Tokens**: port `tokens.css` (oklch palette, type scale, spacing, motion timings) to `apps/web/src/styles/tokens.css`. Re-expose to Tailwind 4 via `@theme` in `apps/web/src/index.css`.
2. **Theming**: dark only in M2. Tokens for light theme are not ported until they're needed.
3. **Density**: balanced only in M2. The Harness "dense / balanced / comfy" toggle and Tweaks panel are explicitly not adopted.
4. **Surface mode**: full-takeover only. The slide-in sidebar variant is not adopted.
5. **Information architecture**:
    - Global sidebar: project switcher, milestone selector, kanban link, then deferred-surface stubs for Inbox, Roster, Milestones, Settings, Bootstrap.
    - Detail-page left rail: 10 sections (Overview, Repo Selection, Investigation, PRD, Code, QA, Review, Timeline, Chat, Costs). Only Overview and Timeline are functional in M2; the others render a small `<DeferredSurface milestone="M5" />` empty-state.
6. **Right rail / agent chrome**: rendered with empty-state copy ("No agent runs yet — agents arrive in M4"). No fake persona data, per FACTORY_RULES rule 6.
7. **Vocabulary mapping**: where the design says "Harness", "Tasks", `TAS-1662`, 5 columns, personas — Goose Hub uses "Goose Hub", "Work Items", repo-qualified ref `github:owner/repo#N`, the 11-lane / 9-default-visible config from PLAN §10, and no persona data in M2.

## Consequences

- **+** The IA stops getting re-litigated each milestone. M5/M6/M7/M8/M9 each light up an existing left-rail section by replacing one stub with real content.
- **+** Tokens and chrome ship once; later UI work is pure feature work.
- **−** The `tokens.css` file uses `oklch()`, which has spotty support in older browsers / screenshot tools. Goose Hub is local-first on modern browsers, so this is acceptable.
- **−** Tailwind 4's `@theme` block introduces a soft dependency on Tailwind 4 specifically; downgrading would require rewriting the token bridge.

## Alternatives considered

- **Build the system from scratch**: rejected — needless duplication of work the design already validated.
- **Use a stock shadcn theme**: rejected — would lose the design's specific colour/typography choices that match PLAN §31's "Linear / Vercel / Raycast / Anthropic Console" reference.
- **Adopt the design verbatim including Tweaks, light theme, and density toggles**: rejected for M2 — those toggles are M17 polish at the earliest, and shipping them now adds inert chrome without value.
