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
- tests near `core/state-source/local-db*.test.ts`

Provider integrations:

- new `core/integrations/jira/*`
- new `core/integrations/bitbucket/*`
- possible MCP-backed adapter boundary if Jira/Bitbucket access comes through MCP rather than direct REST

Server actions:

- `apps/server/src/domains/issues/service.ts`
- possible new integration routes under `apps/server/src/domains/integrations/`
- existing route-id resolution via `apps/server/src/shared/work-item-resolution.ts`

Web UI:

- issue list and detail linked-ref display
- import action for "Import Jira issue"
- import action for "Import assigned to me"
- explicit "Post to Jira" / "Post to Bitbucket" artifact actions

Workflow and PR linking:

- PR open/linking paths in fix/implement workflows
- external ref creation when a Bitbucket PR is opened or discovered
- PRD/investigation artifact post-back actions

## Implementation Order

### PR A: Provider-Agnostic External Ref Hardening

Objective: make sure the local-db external ref layer is provider-neutral enough for Jira and Bitbucket.

Tasks:

1. Audit `work_item_external_refs` helper APIs for GitHub assumptions.
2. Add tests for non-GitHub providers.
3. Add typed provider/kind helpers if needed.
4. Keep existing GitHub import/mirroring behavior passing.

Acceptance:

- `jira` issue refs and `bitbucket` PR refs can be created, updated, listed, and resolved to local Work Items.
- Existing GitHub ref behavior is unchanged.

### PR B: Manual Jira Import

Objective: allow a developer to paste a Jira key/URL and import it into local DB.

Tasks:

1. Add Jira issue key/URL parsing.
2. Add Jira issue fetch adapter.
3. Add import service that maps Jira issue data to a local Work Item and external ref.
4. Add a server action and UI affordance for manual import.
5. Add idempotency and error-path tests.

Acceptance:

- `TAS-123` imports into a local Work Item.
- Re-import updates the local title/body/metadata without duplicating the Work Item.
- Jira workflow status remains unchanged.

### PR C: Assigned-To-Me Jira Import

Objective: make Jira assignment the default team-safe local queue filter.

Tasks:

1. Resolve the current Jira user.
2. Query assigned issues scoped by configured projects.
3. Reuse manual import mapping per issue.
4. Add sync result counts and visible stale/failure handling.
5. Add UI action for "Import assigned to me".

Acceptance:

- Developers can import only their own Jira-assigned queue.
- Imported items remain local and workflow-ready.
- Local rows are not deleted when Jira assignment changes.

### PR D: Local-Only Work Item Creation Polish

Objective: make local-only items first-class for scratch and non-Jira work.

Tasks:

1. Ensure create issue paths do not require an external ref.
2. Ensure PR open/link paths do not require Jira/GitHub issue numbers.
3. Make issue detail display external refs when present and local-only status when absent.
4. Add tests for local-only PR body semantics.

Acceptance:

- A local-only issue can be created, run through workflows, and open/link a PR.
- No fake Jira key or GitHub issue number is emitted.

### PR E: Post-Back Comments

Objective: let developers publish selected Goose Hub outputs back to Jira or Bitbucket.

Tasks:

1. Add explicit post-back actions for PRD, investigation, PR link, and needs-human summaries.
2. Add provider adapters for Jira comments and Bitbucket PR comments.
3. Store successful comment refs in `work_item_external_refs`.
4. Emit warning events on failure.

Acceptance:

- PRD/investigation summaries can be posted to the linked Jira issue.
- PR links can be posted to Jira.
- Bitbucket PR comment post-back works for linked PRs.
- Failures are visible and non-fatal.

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
