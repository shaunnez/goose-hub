# skills/playwright-repro

Captures the broken behaviour of a `type:bug` issue using Playwright. Produces structured artefacts: screenshot paths, video path (if captured), console errors, and repro steps actually executed.

Called AFTER the investigate skill (M6.03) for `type:bug` issues only.

**Playwright is NOT wired into CI.** This skill is for local repro capture only.

## When this skill runs

- Work item type: `bug` (set by triage)
- Called by: Factory investigator workflow, after investigate skill confirms the bug scope
- Not called for: `feature`, `chore`, `research` issues

## Inputs

`contextSchema` (`PlaywrightReproContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Bug issue title |
| `workItem.body` | `string` | Full bug issue body |
| `workItem.reproSteps` | `string` | Repro steps extracted from the issue body |
| `workItem.url` | `string` (optional) | URL of the page exhibiting the bug |

## Outputs

`PlaywrightReproSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `screenshots` | `Screenshot[]` | Ordered screenshots per repro step |
| `screenshots[].path` | `string` | Absolute path to screenshot file |
| `screenshots[].caption` | `string` | Description of what the screenshot shows |
| `screenshots[].step` | `number` | Repro step number this screenshot corresponds to |
| `videoPath` | `string \| null` | Absolute path to video recording, or `null` if not captured |
| `consoleErrors` | `ConsoleEntry[]` | Browser console errors/warnings/info captured during the session |
| `consoleErrors[].message` | `string` | Console message text |
| `consoleErrors[].type` | `"error" \| "warning" \| "info"` | Console entry type |
| `consoleErrors[].url` | `string` (optional) | Source URL of the console entry |
| `reproSteps` | `string[]` | The steps actually executed (may differ from issue if steps were clarified) |
| `reproduced` | `boolean` | Whether the bug was successfully reproduced |
| `notes` | `string` (optional) | Additional context, observations, or explanation if not reproduced |

## Tool allowlist

This skill uses the `validate` tool bundle, which includes Playwright for browser automation.

## Repro failure path

When the bug cannot be reproduced (environment mismatch, flaky timing, missing preconditions):
- `reproduced` is `false`
- `screenshots` may be empty (`[]`)
- `videoPath` is `null` if no recording was made
- `notes` should explain why reproduction failed

## Context allowlist

| Key | Included |
|-----|---------|
| `workItem.title` | yes |
| `workItem.body` | yes |
| `workItem.reproSteps` | yes |
| `workItem.url` | yes |
