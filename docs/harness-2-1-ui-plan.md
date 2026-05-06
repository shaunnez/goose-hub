# Harness 2.1 UI Changes

Design reference: `docs/design/harness-2-1/`

## Implementation order

1. TaskHeader — stage/agent under title
2. Overview — stat row swap + Brief personas
3. Code — section header
4. Review — pre-merge pipeline checks
5. Costs — budget bar + persona grouping
6. QA — folder grouping

---

## 1. TaskHeader (`TaskHeader.tsx`)

Add single line under `<h1>`: `{lane} · {lastPersonaLabel}`  
Style: `text-[12.5px] text-fg-3 mt-1`  
Data: `laneForState(item.state)` already computed, `getPersonaLabel(personaMap, item.lastPersonaId)` already available.  
Zero schema changes.

---

## 2. Overview (`OverviewSection.tsx`)

### Stat row
Remove **Priority** card. Add:

| Card | Label | Value | Sub | Color |
|---|---|---|---|---|
| Files | "Files" | `files.length` or `—` | `+{adds} / −{dels} lines` | default |
| Tests | "Tests" | `{passed} pass` or `—` | `{failed} failing · {skipped} skipped` | `var(--success)` if failed=0 |

Data sources:
- Files: `useQuery(['issue-diff', slug, id])` — already used in CodeDiffSection, pull into Overview too.
- Tests: find `qa.completed` event from `useQuery(['events', slug, id])` → `payload.testRun`

### Brief card
Add `border-t` divider row below the markdown body. Show active persona pill:  
`<avatar initials> · {personaLabel} · {item.state}`  
Only `lastPersonaId` available today — one pill is fine.

---

## 3. Code section (`CodeDiffSection.tsx`)

Add Shell-style section header above the existing header bar:

```
eyebrow: "05 · Code"
title:   "Patch in flight"
hint:    "{personaLabel} · {files.length} files · +{adds} / −{dels}"
```

Persona: from `pr.opened` event `devRunId` or fall back to costs `byStage.get('dev')` personaId.  
No structural changes to the two-panel diff layout.

---

## 4. Review (`ReviewSection.tsx`)

Add a **Pre-merge pipeline** card above the existing `criteriaChecks` list. Five synthesized checks:

| Check | Source event | Field |
|---|---|---|
| Lint clean | `qa.completed` | `tierResults.structural.passed` |
| Tests passing | `qa.completed` | `testRun.failed === 0` or `tierResults.functional.passed` |
| Acceptance criteria | `qa.completed` | all `criteriaResults` passed |
| PR opened | `pr.opened` exists | — |
| Review approved | `review.completed` | `verdict === 'approved'` |

Render as the same checklist row style already used for `criteriaChecks`.  
Omit type check, secret scan, bundle size — no data source for those today.

---

## 5. Costs (`CostsSection.tsx`)

### Budget bar
Fetch `ProjectConfigDto` via existing `fetchProjectConfigs()` API, filter by `projectSlug`.  
Read `budgets.perWorkflowMaxUsd` as the ceiling.

Display: `$X of $Y budget` with a progress bar (width = `totalUsd / perWorkflowMaxUsd * 100%`).  
No projection — too speculative without stage-weight data.

### Persona grouping
Group `CostRowDto[]` by `personaId`. For each group render one row:

| Column | Value |
|---|---|
| Persona | Avatar initials from last segment of personaId slug + display name from personaMap |
| Model | Last row's `modelId` |
| Tokens | Sum `inputTokens + outputTokens`, bar relative to max-persona total |
| Cost | Sum `costUsd`, bar relative to max-persona cost |
| Operations | Distinct `skill` names joined with `, ` |

Null `personaId` rows grouped as "System".

---

## 6. QA test suites (`QASection.tsx` + `QaTestSuiteRow.tsx`)

Group suites by directory prefix: `suite.filePath.split('/').slice(0, -1).join('/')` as group key.  
Suites with no path separator go in a "root" group.

Render a group header row before each group:
```
{groupPath}/   {passCount}/{totalCount} passing
```
Style: `bg-bg-elev-2 text-fg-3 text-[11px] uppercase tracking-wider`

Existing `QaTestSuiteRow` unchanged — just wrapped in the group structure.  
Groups with only one suite: skip group header (no value).

---

## Out of scope (no data today)
- Type check pass/fail check in Review
- Secret scan / bundle size checks in Review
- Projection in Costs
- Multi-persona Brief pills (only `lastPersonaId` available)
