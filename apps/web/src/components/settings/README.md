# settings

Settings panel for registered project configs and local runtime controls.

## Structure

```
settings/
  components/
    SettingsPage.tsx                 — top-level page (list + detail layout)
    ProjectConfigPanel.tsx           — read-only display of a single ProjectConfig
    WorkflowMapPanel.tsx             — data/query orchestration for the workflow map tab
    WorkflowMapFlow.tsx              — vertical effective-flow renderer
    WorkflowPipelineReviewSettings.tsx — pipeline/review settings summary strip
    WorkflowSkillDetailModal.tsx     — selected skill metadata modal
  lib/
    workflow-map.ts        — feature-local workflow map helpers and view-model types
  slice.test.ts
  README.md
```

## Route

`/settings` (global, not project-scoped — shows all registered projects)

## Data

`GET /projects/configs` -> `ProjectConfigDto[]`

Fields shown per project: slug, source, activeMilestone, mode, colorStripe, budget limits.

The Skill runtime settings tab reads `GET /projects/:slug/settings` and shows
editable per-skill overrides for budget, tier, provider, and effort. The same
response includes resolved runtime attribution, so each row can explain where
the effective tier/provider/effort came from while keeping primary, fallback,
and advisor models read-only.

The Workflow map tab also reads:

- `GET /workflow-catalog`
- `GET /projects/:slug/settings`
- `GET /projects/:slug/settings/pipeline`
- `GET /projects/:slug/settings/dev-review`
- `GET /projects/:slug/settings/review`

It renders the effective vertical path for the selected project: active variants are highlighted,
inactive alternatives are muted, conditional/retry branches stay secondary, and selected skill
details open in a modal. Skill nodes stay lightweight; the modal reuses
`resolvedSkillRuntimes` to show resolved primary runtime plus tier/provider/effort attribution.
