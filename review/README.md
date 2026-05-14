# Goose Hub — Code Review

A senior-developer pass over the codebase: how it's wired, where the rough
edges are, and what to fix first. Skim `01-orientation.md` if you're new.

| File | Purpose |
|---|---|
| [`01-orientation.md`](./01-orientation.md) | One-page tour for a new dev: vocabulary, what runs where, what to read next. |
| [`02-architecture.md`](./02-architecture.md) | Layer map (apps / core / slices / skills) + how a webhook becomes a PR. |
| [`03-flows.md`](./03-flows.md) | Mermaid flow diagrams: dispatch routing, fix-issue, QA→Review→approval, retro. |
| [`04-data-model.md`](./04-data-model.md) | DB schema diagram + table-by-table notes. |
| [`05-findings.md`](./05-findings.md) | Concrete bugs, smells, and refactors. Prioritised. |
| [`06-performance.md`](./06-performance.md) | Hot paths, indexes, where to add caching, what to leave alone. |
| [`07-quick-wins.md`](./07-quick-wins.md) | Two-hour pickups that improve correctness or readability now. |

## How this review was scoped

- Read on the `claude/code-review-documentation-xoWCG` branch.
- Survey-first: `apps/`, `core/`, `slices/`, `skills/`, `docs/inventory.md`,
  `CLAUDE.md`, `CONTEXT.md`, `FACTORY_RULES.md`.
- Targeted reads of high-leverage modules: `event-stream/store.ts`,
  `agent-runtime/{claude-cli,invoke-skill,select-persona}.ts`,
  `db/{db,schema}.ts`, `projects/parallel-lock.ts`, `shared/dispatch-*.ts`,
  `state-source/{dependency-parser,github-labels}.ts`, hooks.
- No code changes shipped — this is documentation only. Each finding has a
  one-line fix sketch so the next dev can land it without a re-read.

## Two-sentence verdict

The architecture is honest: vertical slices, single-writer event log,
stateless ticks, holdouts enforced at the runtime layer. Most issues are
small (missing indexes, brittle parsers, a couple of TOCTOUs around DB
counters), and the only thing that really wants attention is the
listener-leak / orphan-run interaction in `event-stream/store.ts` if this
ever runs >1 process against the same DB.
