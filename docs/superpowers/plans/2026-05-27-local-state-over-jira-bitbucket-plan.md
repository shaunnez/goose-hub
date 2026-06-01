# Local State Over Jira and Bitbucket Plan

Date: 2026-05-27
Base branch: `bootstrap-remote-localdb`
Target PR branch: create a worktree branch off `bootstrap-remote-localdb` and PR back into `bootstrap-remote-localdb`, not `main`.

## Goal

Make Goose Hub work as a personal local execution layer over the team's current Jira and Bitbucket workflow.

Jira and Bitbucket remain the team coordination systems for now. Goose Hub imports or links their objects, but local SQLite owns Factory lifecycle state, artifacts, agent runs, PRD state, investigation state, and comments created inside Goose Hub.

```text
Jira issue / Bitbucket PR
        |
        | import / link / post comments
        v
Local Goose Hub SQLite
        |
        | owns Factory workflow
        v
Local agent runs, PRDs, investigations, worktrees
```

This plan builds on the `source.kind = "local-db"` direction in `bootstrap-remote-localdb`. It does not introduce a shared Goose Hub server or shared operational DB.

## Core Rule

For `source.kind = "local-db"`:

- Jira and Bitbucket are external refs, not Work Item identity.
- Local Work Item ids remain local, for example `local:<project>#123`.
- Factory states remain local: `factory:triaging`, `factory:prd-review`, `factory:dev-ready`, and related lifecycle states.
- External tracker state may be displayed, but it does not automatically drive Goose Hub workflow.
- Goose Hub may post concise updates back to Jira or Bitbucket, but those systems are referential/projection layers for this phase.

## Current Branch Context

The `bootstrap-remote-localdb` branch already establishes the right foundation:

- `work_items` stores local Work Items.
- `work_item_external_refs` links external issues, PRs, branches, comments, and commits.
- `LocalDbStateSource` is the lifecycle-authoritative state source for local-db projects.
- GitHub issue import and optional label mirroring show the intended integration/projection pattern.

This plan extends that pattern to Jira and Bitbucket without turning either provider into Factory authority.

## Current Code Audit

Audit date: 2026-05-27 on `bootstrap-remote-localdb`.

What is already in place:

- `core/types.ts` has `SourceConfig` support for `source.kind = "local-db"`, but `LocalDbSourceConfig.integrations` currently only types `github`.
- `core/db/schema.ts` has provider-neutral `work_item_external_refs` columns: `provider`, `kind`, nullable `repo_ref`, `external_id`, `url`, and `metadata_json`.
- `core/state-source/local-db-repository.ts` already exposes provider-neutral helpers for external refs: `upsertExternalRef`, `getExternalRef`, `getWorkItemByExternalRef`, `listExternalRefsByKind`, and `listExternalRefs`.
- `core/state-source/local-db-repository.test.ts` already proves Jira issue refs can be stored without `repo_ref`, and Bitbucket pull request refs can be stored with `repo_ref`.
- `core/integrations/github/import-issues.ts` is the closest existing pattern for idempotently importing external work into local Work Items plus external refs.
- `core/agent-artifacts/repository.ts` already has threshold-based local payload offload through `maybeStoreLargePayload`, `storeArtifact`, `deterministicArtifactKey`, and `getArtifact`.

Gaps to close before Jira and Bitbucket are first-class:

- `LocalDbSourceConfig.integrations` needs typed `jira` and `bitbucket` blocks. Do not store credentials in project config.
- No `core/integrations/jira/*`, `core/integrations/bitbucket/*`, or shared Atlassian service/DTO layer exists.
- No server route exists for manual Jira import, assigned-to-me import, external-ref listing, artifact slicing, or post-back.
- `apps/server/src/domains/issues/service.ts` returns Work Items without external refs, so the UI cannot distinguish imported Jira work from local-only work.
- `apps/web/src/components/detail/components/DetailPage.tsx` still synthesizes live event ids as `github:${item.repoRef}#${item.externalId}`. Local-db detail pages should use the canonical `item.id`.
- `LocalDbStateSource.getPrDiff` only reads GitHub PR refs. Bitbucket PR diff/linking needs its own adapter path and must not be treated as GitHub-compatible.
- Artifact retrieval currently returns the whole payload for a work-item artifact. Atlassian comments/history/page bodies need slice retrieval so large evidence does not re-enter context by default.
- `activateLocalDbProject` imports only GitHub issues. Jira import should be a separate explicit action, not a bootstrap side effect.
- Current project config in `target-projects/goose-hub-self/project.config.ts` is still GitHub-backed; Jira/Bitbucket rollout needs at least one local-db target project config or fixture for tests.

## Atlassian Integration Contract

Adapt the SkyTab SDK/CLI guidance to Goose Hub's TypeScript stack:

- Use Zod schemas and TypeScript DTOs instead of Pydantic models.
- Put provider access behind typed service modules. The agent, workflow, server action, or UI never sees raw Jira or Bitbucket payloads.
- Prefer direct REST adapters first unless a proven CLI is the safer implementation path. If a CLI adapter is added, it must return JSON, use `spawn` without `shell: true`, cap output, set a timeout, and parse immediately into Zod-validated DTOs.
- The service owns query-level resolution. Exact Jira keys and URLs are L0 and must short-circuit before search. Assigned-to-me import builds safe scoped JQL internally. Raw JQL is absent from normal user/agent tools.
- Return progressive response tiers:
  - `headline`: key/id, title, status, url, total count, `hasMore`
  - `card`: headline plus project, issue type, assignee, priority, created, updated
  - `detail`: card plus capped description/body preview, labels/components, linked keys
  - `evidence`: comments, changelog/history, attachments, and large bodies stored as artifacts and retrieved by slice
  - `raw`: developer-only, stored as an artifact, never returned inline by default
- Use `core/agent-artifacts/repository.ts` as the scratchpad/store. Large Jira/Bitbucket payloads should produce summaries plus artifact refs, not full context dumps.
- Provider errors should be typed enough for callers to distinguish validation, auth, permission, not-found, query, rate-limit, connection, and post-back failures.

## Non-Goals

- Do not create a shared Goose Hub hub/server.
- Do not create a shared Goose Hub DB.
- Do not add cross-developer visibility in this plan.
- Do not add Goose Hub leases unless a later plan supports "pull next from shared queue".
- Do not automatically transition Jira workflow states.
- Do not replace Jira as the team coordination layer.
- Do not make Bitbucket PRs required for local-only Work Items.

## Data Model

Use `work_items` as the local authoritative record.

Use `work_item_external_refs` for provider links:

```text
provider: "jira"
kind: "issue"
external_id: "TAS-123"
url: "https://company.atlassian.net/browse/TAS-123"
metadata_json: {
  status,
  assignee,
  issueType,
  priority,
  lastSyncedAt
}

provider: "bitbucket"
kind: "pull_request"
repo_ref: "workspace/repo"
external_id: "45"
url: "https://bitbucket.org/workspace/repo/pull-requests/45"
metadata_json: {
  branch,
  targetBranch,
  state,
  lastSyncedAt
}
```

If recurring provider sync needs durable cursors, add a small integration sync table later:

```text
project_integration_syncs
- project_id
- provider
- scope
- cursor
- last_synced_at
- last_error
```

Do not add Jira-specific or Bitbucket-specific columns to `work_items`.

## Project Config Shape

Extend local-db source integrations with provider-specific blocks:

```ts
source: {
  kind: "local-db",
  stateMachine: "db",
  integrations: {
    jira: {
      enabled: true,
      baseUrl: "https://company.atlassian.net",
      projectKeys: ["TAS"],
      importMode: "manual" | "assigned-to-me",
      postBack: {
        comments: true,
        transitions: false,
      },
    },
    bitbucket: {
      enabled: true,
      workspace: "company",
      repos: ["api", "web"],
      postBack: {
        pullRequests: true,
        comments: true,
      },
    },
  },
}
```

Config should allow provider credentials to be resolved locally through environment variables, CLI auth, MCP, or future machine-scoped settings. Do not store personal tokens in project config.

## Mode 1: Manual Jira Import

First implementation target.

The developer pastes a Jira key or URL:

```text
TAS-123
https://company.atlassian.net/browse/TAS-123
```

Goose Hub should:

1. Parse the Jira key or URL.
2. Fetch the Jira issue through the configured Jira integration.
3. Create or update a local `work_items` row.
4. Store the Jira issue ref in `work_item_external_refs`.
5. Copy useful fields into the local Work Item:
   - title
   - description/body
   - issue type
   - priority
   - assignee metadata
   - current Jira status metadata
6. Leave Jira workflow status unchanged.
7. Show the imported issue in the Goose Hub kanban and detail views.

Acceptance:

- Importing the same Jira issue twice is idempotent.
- The local Work Item can run grill, PRD, investigate, implement, QA, and review workflows.
- Jira remains linked but not authoritative.
- Import failure reports the provider error without creating a partial Work Item.

## Mode 2: Assigned-To-Me Jira Import

Second implementation target and likely team default.

The developer clicks "Import my Jira issues".

Goose Hub should:

1. Resolve the current Jira user.
2. Query issues assigned to that user, scoped by configured Jira projects.
3. Import each issue idempotently into local DB.
4. Store/update Jira metadata on each external ref.
5. Optionally mark local imported items no longer assigned to the user as hidden or stale.
6. Never delete local Work Items automatically because local work may have artifacts or runs attached.

This mode avoids needing a Goose Hub lease at first. Jira assignment remains the team coordination mechanism.

Acceptance:

- Two developers importing "assigned to me" get different local queues when Jira assignments differ.
- No central Goose Hub server is required.
- No issue is auto-run just because it exists in Jira.
- Sync result counts report imported, updated, skipped, stale, and failed issues.

## Mode 3: Local-Only Issue Creation

Developers can create local work that may never exist in Jira.

Examples:

- scratch investigation
- refactor
- internal tech debt
- spike
- "review this PR"
- "grill me on this idea"

Goose Hub should:

1. Create a `work_items` row without a Jira external ref.
2. Allow normal local workflow execution.
3. Allow the Work Item to be linked to Jira or Bitbucket later.
4. Open implementation PRs without pretending the local external id is a Jira issue key.

Acceptance:

- Local-only items fully support Goose Hub workflows.
- PRs opened from local-only items do not include fake Jira close keywords.
- The issue detail page clearly distinguishes local-only work from imported Jira work.

## Mode 4: Post-Back Integration

After local workflow produces useful output, Goose Hub can post selected summaries back to Jira or Bitbucket.

Examples:

- "Factory started investigation"
- investigation summary
- "PRD ready for review"
- "PR opened: Bitbucket PR #45"
- "Needs human input"
- "Implementation complete"

Important boundary:

- Posting comments is allowed.
- Linking PRs is allowed.
- Jira transitions are off by default.
- Jira status must not automatically mutate Goose Hub state.
- Goose Hub state must not automatically mutate Jira status unless explicitly configured in a later plan.

Acceptance:

- User can choose which artifact to post back.
- Posted comments are concise and sanitized.
- Post-back failure emits a visible warning but does not fail the local Goose Hub workflow.
- Post-back output references external refs instead of replacing local Work Item identity.

## Likely Files and Seams

Provider config and types:

- `core/types.ts`
- `core/state-source/local-db.ts`
- `core/state-source/local-db-repository.ts`
- `core/agent-artifacts/repository.ts`
- tests near `core/state-source/local-db*.test.ts`

Provider integrations:

- new `core/integrations/atlassian/*` for shared Zod DTOs, query-level resolution, payload offload, and typed errors
- new `core/integrations/jira/*`
- new `core/integrations/bitbucket/*`
- REST adapters first; optional CLI adapters only if they emit JSON and follow Factory subprocess rules
- no open-ended Atlassian MCP tool surface for normal agent or UI paths

Server actions:

- `apps/server/src/domains/issues/service.ts`
- new integration routes under `apps/server/src/domains/integrations/`
- `apps/server/src/server.ts` route registration
- existing route-id resolution via `apps/server/src/shared/work-item-resolution.ts`
- issue artifact routes for bounded slice retrieval

Web UI:

- `apps/web/src/lib/types.ts`
- `apps/web/src/components/detail/components/DetailPage.tsx`
- issue list and detail linked-ref display
- import action for "Import Jira issue"
- import action for "Import assigned to me"
- explicit "Post to Jira" / "Post to Bitbucket" artifact actions

Workflow and PR linking:

- PR open/linking paths in fix/implement workflows
- external ref creation when a Bitbucket PR is opened or discovered
- PRD/investigation artifact post-back actions

## Final Implementation Order

### PR A: Local-DB External Ref Read Model and Canonical IDs

Objective: finish the provider-neutral local-db surface before adding Atlassian behavior.

Tasks:

1. Keep the existing provider-neutral repository APIs and tests in `core/state-source/local-db-repository.ts`.
2. Add typed external-ref DTO helpers around `LocalDbExternalRefRow` so callers do not parse `metadata_json` ad hoc.
3. Add external refs to the Work Item server DTO in `apps/server/src/domains/issues/service.ts`.
4. Add `canonicalWorkItemId` or use `item.id` in the web Work Item DTO.
5. Fix `apps/web/src/components/detail/components/DetailPage.tsx` so local-db detail pages subscribe to `item.id`, not `github:${item.repoRef}#${item.externalId}`.
6. Add UI display for linked refs and explicit local-only status on the issue detail page.
7. Add artifact slice retrieval support for work-item artifacts so stored provider evidence can be fetched by key plus slice range.

Acceptance:

- Existing GitHub local-db import/mirroring behavior is unchanged.
- `jira` issue refs and `bitbucket` pull request refs can be listed through the issue API.
- Local-db detail pages query and subscribe with canonical local Work Item ids.
- The issue detail page distinguishes local-only Work Items from imported or linked external Work Items.
- Stored artifact retrieval can return a bounded slice without returning the full payload.

### PR B: Atlassian Config, DTOs, and Safe Service Boundary

Objective: establish the TypeScript Atlassian integration contract without importing anything yet.

Tasks:

1. Extend `LocalDbSourceConfig.integrations` in `core/types.ts` with typed `jira` and `bitbucket` blocks matching this plan.
2. Add Zod DTOs for Atlassian headline/card/detail/evidence refs under `core/integrations/atlassian/`.
3. Add Jira key and URL parsing with exact-key-first behavior.
4. Add query-level resolution helpers for L0/L1/L2/L3, but expose only the levels needed by manual and assigned-to-me import.
5. Add typed provider error classes or result variants: validation, auth, permission, not_found, query, rate_limit, connection, post_back.
6. Add an adapter interface for provider calls. Implement Jira REST behind the interface first; keep a CLI adapter as an optional later substitution.
7. Add payload offload helpers that wrap `maybeStoreLargePayload` with deterministic artifact keys derived from provider, query/resource id, tier, and user-facing args.

Acceptance:

- Config typing permits Jira and Bitbucket integrations without allowing credentials in project config.
- Exact Jira keys and URLs resolve to L0 without constructing search JQL.
- Free-text helper tests prove max-result caps and date/project bounds are applied before provider calls.
- Large provider payloads produce summaries plus artifact refs.
- No raw JQL/CQL or raw provider object crosses the service boundary.

### PR C: Manual Jira Import

Objective: allow a developer to paste a Jira key or URL and import it into local DB.

Tasks:

1. Add `core/integrations/jira/import-issue.ts` using the service from PR B.
2. Map Jira detail DTOs into `work_items`: title, body/description preview or sanitized body, type, priority, assignee metadata, status metadata, and default local Factory state.
3. Store the Jira issue ref in `work_item_external_refs` with `provider = "jira"`, `kind = "issue"`, `repo_ref = null`, and `external_id = <issue key>`.
4. Store large comments, history, changelog, attachments, and raw detail as `agent_artifacts` when requested or above threshold.
5. Add `POST /projects/:slug/integrations/jira/import` or a similarly scoped route under `apps/server/src/domains/integrations/`.
6. Add an "Import Jira issue" UI action that accepts a key or URL, reports typed errors, and links to the created local Work Item.
7. Add idempotency and failure-path tests.

Acceptance:

- `TAS-123` and a configured Jira browse URL import into a local Work Item.
- Re-import updates the local title/body/metadata and external ref without duplicating the Work Item.
- Jira workflow status is copied into external-ref metadata but never mutates local Factory state.
- Provider failure returns a visible typed error and does not create a partial Work Item.

### PR D: Assigned-To-Me Jira Import

Objective: make Jira assignment the team-safe way to populate each developer's local queue.

Tasks:

1. Add a service method to resolve the current Jira user.
2. Build safe JQL internally from configured `baseUrl`, `projectKeys`, current user, max results, and updated date bounds.
3. Reuse the manual import mapper per returned issue.
4. Report counts: imported, updated, skipped, stale, failed.
5. Mark no-longer-assigned local imports as stale/hidden metadata only; do not delete local Work Items.
6. Add `POST /projects/:slug/integrations/jira/import-assigned-to-me`.
7. Add an "Import my Jira issues" UI action with result counts and per-issue failures.

Acceptance:

- Developers importing assigned-to-me receive only Jira issues assigned to their current Jira user and configured projects.
- Local rows are never auto-run or deleted by sync.
- Existing local artifacts/runs/comments remain attached when Jira assignment changes.
- Sync result counts are shown and tested.

### PR E: Local-Only Work Item and PR Semantics

Objective: make non-Jira work and local-only PR flows explicit.

Tasks:

1. Ensure local Work Item creation does not require any external ref.
2. Ensure implementation and PR-opening paths do not require Jira, GitHub, or numeric external issue ids.
3. Keep `core/connectors/github/slice.test.ts` coverage for local-db PRs without closing GitHub issue lines, and extend it for imported Jira and local-only Work Items if needed.
4. Ensure PR bodies reference linked external refs only as context, not as close keywords unless the provider integration explicitly supports that behavior later.
5. Add UI copy/state that clearly identifies local-only work.

Acceptance:

- A local-only issue can be created, run through workflows, and open/link a PR.
- PR bodies do not emit fake Jira keys, fake GitHub issue numbers, or auto-close keywords for local-only Work Items.
- Imported Jira Work Items keep local identity in Goose Hub routes and events.

### PR F: Bitbucket PR Linking and Diff Adapter

Objective: support Bitbucket PR refs as projection links without making Bitbucket a Work Item authority.

Tasks:

1. Add Bitbucket config typing and REST adapter under `core/integrations/bitbucket/`.
2. Add helpers to upsert Bitbucket PR refs with `provider = "bitbucket"`, `kind = "pull_request"`, `repo_ref = "workspace/repo"`, and `external_id = <pr id>`.
3. Update implementation/PR linking paths so Bitbucket PRs can be attached to local Work Items when discovered or opened.
4. Add a Bitbucket diff-fetching path instead of extending `LocalDbStateSource.getPrDiff` with GitHub assumptions.
5. Keep Bitbucket PR state in external-ref metadata only.

Acceptance:

- A local Work Item can link to a Bitbucket PR.
- Bitbucket PR metadata can be updated idempotently.
- Diff retrieval is provider-specific and does not require `GITHUB_TOKEN`.
- Bitbucket PR state never drives local Factory state automatically.

### PR G: Explicit Post-Back Comments

Objective: let developers publish selected Goose Hub outputs back to Jira or Bitbucket.

Tasks:

1. Add explicit post-back actions for PRD summary, investigation summary, PR link, and needs-human summary.
2. Add Jira issue comment and Bitbucket PR comment adapters.
3. Sanitize and cap generated post-back text before provider calls.
4. Store successful comment refs in `work_item_external_refs` with `kind = "comment"` and provider-specific metadata.
5. Emit visible warning events on post-back failure and keep the local workflow successful.
6. Add UI affordances that require an explicit user action to post back.

Acceptance:

- PRD and investigation summaries can be posted to a linked Jira issue.
- PR links can be posted to Jira.
- Bitbucket PR comments can be posted to linked PRs.
- Failures are visible, typed, and non-fatal.
- Post-back references external refs and never replaces local Work Item identity.

## Cross-Slice Invariants

- Local SQLite remains Factory lifecycle authority.
- Jira and Bitbucket remain referential/projection layers.
- Imported external objects become local Work Items plus external refs.
- External refs are links, not identity.
- No shared DB or shared server is introduced in this plan.
- No provider webhook directly mutates local Factory state.
- Existing GitHub local-db behavior from `bootstrap-remote-localdb` stays intact.

## Later Follow-Ups

These belong in separate plans:

- shared Goose Hub read model / team hub
- PM/reviewer shared approval inbox
- team-visible kanban projection
- Goose Hub-owned cross-developer leases
- automatic Jira workflow transitions
- provider webhook reconciliation
