# settings

Read-only settings panel for registered project configs. Closes #280.

## Structure

```
settings/
  components/
    SettingsPage.tsx       — top-level page (list + detail layout)
    ProjectConfigPanel.tsx — read-only display of a single ProjectConfig
  slice.test.ts
  README.md
```

## Route

`/settings` (global, not project-scoped — shows all registered projects)

## Data

`GET /projects/configs` → `ProjectConfigDto[]`

Fields shown per project: slug, source, activeMilestone, mode, colorStripe, budget limits.
All fields are display-only. Editing requires modifying `target-projects/<slug>/project.config.ts`
and restarting the server. The Reload button invalidates the React Query cache.
