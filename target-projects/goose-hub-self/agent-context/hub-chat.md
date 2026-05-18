## Project quirks for the Hub Chat assistant

The user (Shaun) runs **Goose Hub** — the local-first command centre — and
operates on a single registered project, `goose-hub-self`, which is also the
repo you're embedded in. Most chat questions resolve against this project.

## Where things live

| Question | Source of truth |
|---|---|
| "Why is X wired this way?" | `CONTEXT.md` (resolved decisions) → `docs/adr/` (long-form ADRs) |
| "What's the rule about Y?" | `FACTORY_RULES.md` (numbered, currently 1–33) |
| "What's the active milestone?" | `target-projects/goose-hub-self/project.config.ts` → `activeMilestone` field |
| "Where's the workflow for state Z?" | `slices/<name>/workflow.ts` first; `core/workflows/` only when 2+ callers |
| "What skills exist?" | `skills/<name>/` — each has `prompt.md`, `schema.ts`, `skill.config.ts` |

## Naming conventions

- Work item ids: `github:shaunnez/goose-hub#<N>` — always the full form on events; chat shorthand `#N` should be resolved against `goose-hub-self` by default.
- State labels live on **issues**, never PRs. Labels are `factory:<state>`.
- PR titles follow `M<milestone>.<task>: <one-line>`, e.g. `M20.16: richer find_pr via GitHub PR search`.
- Branch convention: `claude/m<milestone>-<task>-<slug>` for milestone work.

## When the user says…

- **"the milestone"** — they mean the value of `activeMilestone` in `goose-hub-self/project.config.ts`. Don't list milestones unless asked.
- **"what's stuck"** — surface `factory:needs-human`, `factory:gate-pending`, and recent `agent.run-failed` events. `what_needs_human_help` covers this.
- **"the chat backlog"** — M20 follow-ups under `area:web` / `area:agent-runtime` with `schedule:current`.
- **"the kanban"** — `/projects/goose-hub-self`. The default landing route.

## Anti-patterns — don't propose these

- **No tools that modify governance files** (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `target-projects/<slug>/project.config.ts`, `target-projects/<slug>/personas/`). Factory PRs can't touch them per FACTORY_RULES rule 12. If the user asks for a change there, reply with a one-liner explaining the rule-12 carve-out and offer to draft the edit as text for them to apply.
- **No `invoke_skill` for holdouts** — `qa`, `review`, `retro`, `retro-deep` must run from a workflow. The tool rejects these already; don't propose them.
- **No `tick_project` mid-conversation** without asking — it dispatches whatever the orchestrator picks next, which is rarely what the user meant.

## Hot directories the user refers to often

- `apps/server/src/domains/<name>/` — server routes (router → service → repository layering enforced by `apps/server/STANDARDS.md`).
- `apps/web/src/components/<name>/` — UI features as vertical slices.
- `slices/<name>/` — workflow slices, one per orchestrator phase.
- `skills/<name>/` — versioned agent prompts.
- `target-projects/<slug>/agent-context/<skillName>.md` — per-project overlays loaded by `readPromptWithContext()`.
