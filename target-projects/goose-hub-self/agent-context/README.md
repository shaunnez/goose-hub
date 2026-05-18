# agent-context overlays

Per-skill prompt overlays for the `goose-hub-self` target project. Each
`<skillName>.md` file in this directory is appended to the corresponding
skill's base prompt (`skills/<skillName>/prompt.md`) at spawn time via
`readPromptWithContext(skillName, 'goose-hub-self')` in
`core/agent-runtime/read-prompt.ts`.

## When to add an overlay

When a skill needs project-specific guidance that doesn't belong in the
universal `skills/<name>/prompt.md`:

- Project quirks the agent should know about (hot files, naming
  conventions, anti-patterns).
- Vocabulary specific to this project (e.g. "the milestone" means the
  active milestone in `project.config.ts`).
- Pointers to the right governance / docs (CONTEXT.md, FACTORY_RULES.md).

Keep overlays tight and resolved — they ride alongside the prompt on every
spawn. Long histories of decisions belong in `docs/adr/`, not here.

## Files

| File | Skill | Purpose |
|---|---|---|
| `advise-on-plan.md` | `advise-on-plan` | Advisor pattern reminders |
| `evidence-post.md` | `evidence-post` | Where evidence goes on this project |
| `hub-chat.md` | `hub-chat` | Hub Chat assistant project-specific quirks |
| `implement.md` | `implement` | Dev conventions for this repo |
| `investigate.md` | `investigate` | Investigation pointers (CONTEXT.md, etc.) |
| `playwright-repro.md` | `playwright-repro` | Repro spec conventions |
| `qa.md` | `qa` | Test commands, known noise, slice structure |
| `spec-author.md` | `spec-author` | Spec authoring conventions |

## How loading works

```ts
// In core/agent-runtime/read-prompt.ts
const base = readPrompt(skillName);                      // skills/<name>/prompt.md
const overlayPath = `target-projects/${projectSlug}/agent-context/${skillName}.md`;
const overlay = fs.existsSync(overlayPath) ? read(overlayPath) : '';
return [base, overlay].filter(Boolean).join('\n\n');
```

Missing overlay files are silently skipped — adding an overlay is opt-in
per (project, skill).

## Governance status

`target-projects/<slug>/agent-context/*.md` files are **not** in the
FACTORY_RULES rule-12 governance perimeter. They can be edited by any
Factory PR. Governance-locked content (`project.config.ts`,
`MISSION.md`, `FACTORY_RULES.md`, `personas/`) lives elsewhere in this
directory tree.
