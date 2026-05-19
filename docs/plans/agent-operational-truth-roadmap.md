# Agent operational truth roadmap

## Context

Factory agents currently return structured JSON that workflows treat as operational fact. That is brittle. A model can report package-relative paths, omit touched files, misstate test paths, or describe evidence artifacts in a shape that does not match the worktree.

Path normalization is the first prerequisite. After that, the remaining work is to move operational truth out of model-authored prose and into Factory-owned tools, workflow checks, git diffs, test runners, collectors, and event payloads.

This roadmap coordinates the follow-on plans. Each plan is independently iterable after the prerequisite lands.

## Prerequisite

Complete the repo-relative path normalization plan first:

- define one canonical `RepoRelativePath` contract,
- normalize implement, implement-wp, investigate, spec-author, evidence, and QA path fields,
- block ambiguous path repair,
- update prompts and schema descriptions to require worktree-root-relative POSIX paths.

Do not start the plans below until workflow consumers can rely on canonical path strings.

## Ordered Plans

1. [Factory-tools canonical path integration](./factory-tools-canonical-paths.md)
2. [Workflow-owned operational facts](./workflow-owned-operational-facts.md)
3. [Workflow contract repair gates](./workflow-contract-repair-gates.md)
4. [Telemetry and prompt hardening](./telemetry-and-prompt-hardening.md)

## Resume Rule

When asked to continue this roadmap:

1. Read this file.
2. Confirm the path-normalization prerequisite is complete.
3. Pick the first plan whose acceptance criteria are not satisfied.
4. Complete only the next unchecked slice in that plan.
5. Update the plan document with status and notes.
6. Stop and report the slice completed plus the next slice.

## Target End State

- Agents express intent and judgment.
- Factory tools own path resolution, command construction, workspace scope, output caps, and audit events.
- Workflows derive changed files, tests run, evidence artifacts, and PR metadata from observed system state.
- Model JSON remains useful for explanations, confidence, plans, and decision summaries, but not as the source of record for facts Factory can observe.
- UI and telemetry distinguish reads, writes, reported paths, normalized paths, changed files, and guard failures.

## Global Invariants

- All persisted file paths are repo-root/worktree-root relative POSIX paths.
- Every path-sensitive gate receives normalized paths or calls the shared normalizer.
- Ambiguous normalization does not silently choose a candidate.
- Workflow-owned evidence wins over model-declared facts.
- Prompt rules are guidance only; enforcement lives in tools and workflows.

