# Factory Rules

These are non-negotiable. Every Factory PR is checked against them. Hard-fail any PR that violates any rule.

These rules are immutable. Factory cannot modify this file. Humans can modify it only through direct repo access, and should not — these rules are set at M0 and held.

## State and validation

1. The Reviewer and QA agents never see implementation reasoning, plans, decision summaries, or chat history. They check outcome against the original issue.
2. Triage has only two verdicts: accept or reject. No "needs human" middle state.
3. QA runs before Review. Sequential. Review never sees a PR that QA didn't validate.
4. Fix steps run in fresh agent context. Validators on the next pass are true holdouts.
5. Every agent run produces JSON conforming to its skill schema. Invalid output fails the run.
6. Agents emit `agent.decision-summary` events at decision points: single sentence, no chain-of-thought, no secrets, no PII. Silent agents fail review.

## Authority and scope

7. The orchestrator is stateless across ticks. Work-item state lives in the project's source of truth. Operational state lives in local SQLite.
8. Each project's source of truth lives in its own repository's issue tracker (or workspace, for Jira/Linear). Goose Hub never centralises authority over work items.
9. State labels live on **issues**, not PRs. PR labels are decorative only.
10. Cross-repo dependencies (`Depends on owner/repo#N`) require the dependency repo to be a registered target project. Otherwise the issue moves to `factory:needs-human`.
11. Bootstrap is required before any other workflow runs against a target project. No workflows on unbootstrapped projects.

## Governance

12. Governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, project configs, persona configs) cannot be **modified** by any Factory PR. They can be **created** only in PRs tagged `factory:bootstrap-pr`. Hard-fail PR check otherwise.
13. Skills are versioned markdown with JSON schemas. Inline prompts in code fail review.

## Concurrency, budgets, safety

14. One workflow at a time per project. (M11+ may relax to one workflow per work item; documented in an ADR when that lands.)
15. Per-project budget caps enforced before workflow start and at every agent spawn.
16. Flood protection: non-owner issues capped at `maxIssuesPerDayFromNonOwners` per project.
17. Every workflow node has a max budget. Triage batches max 10 issues, body truncation at 2KB.
18. Fix attempts capped at `maxRetries`. After cap, escalate to `factory:needs-human`.
19. Tool calls outside an agent's role allowlist are rejected at the dispatcher with a logged event.

## Advisors and fallbacks

20. Advisor never runs on QA or Review. Holdouts remain holdouts.
21. Advisor revisions capped at one. After that, escalate to human.
22. Advisor disabled by default in autonomous mode. Explicit opt-in per project.
23. Fallback never down-tiers on `priority:critical` or `priority:high`. Fallback is forbidden on holdouts (QA, Reviewer); on primary failure, escalate.

## Architecture

24. Vertical slices, never horizontal layers. Every feature ships as a slice including only the surfaces it touches; `slice.test.ts` and `README.md` are required.
25. Autonomous mode requires Docker isolation. Supervised mode runs natively (and is observational, not isolated — the human PR review is the real safety mechanism).
26. CI YAML in `.github/workflows/` is allowed. Product workflows are TypeScript modules in `core/orchestrator/workflows/` — never YAML.
27. No new heavyweight dependencies (vector DB, embedding service, etc.) without explicit human approval and an ADR.

## Feedback loop

28. Retrospective runs after every successful merge. Light by default; deep on triggers. Improvement candidates surface as Factory issues in the relevant target repo, never auto-applied.
