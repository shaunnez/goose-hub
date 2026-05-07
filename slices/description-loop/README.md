# slices/description-loop

Skill auto-trigger description loop (eval Layer 1). Closes M11.19 (#557).

## What it does

Layer-1 of Steve's skill self-improvement loop: measures how accurately each
skill's description matches its intended trigger prompts.

### `core/learning/description-loop.ts`

| Export | Description |
|--------|-------------|
| `runDescriptionLoop(skillName, opts)` | Runs the loop; returns `{ tpRate, tnRate, accuracy, failures }` |
| `loadTriggers(skillName, root?)` | Loads `skills/<name>/triggers.json`; null if absent |
| `loadSkillDescription(skillName, root?)` | Reads first paragraph from `prompt.md` |
| `validateTriggers(triggers)` | Returns list of violations (empty = valid) |

### Classification

Trigger classification uses keyword-overlap between the skill's prompt.md
description and the candidate prompt. No LLM tokens consumed (~0 cost/skill).

A prompt "triggers" when it shares ≥1 significant term with the skill description
AND the overlap covers ≥20% of the description vocabulary.

### `triggers.json` format

```json
{
  "shouldTrigger": ["at least 3 prompts that should trigger this skill"],
  "shouldNotTrigger": ["at least 3 prompts that must not trigger this skill"]
}
```

Validator enforces: ≥3 entries in each category, no overlap between the two lists.

### Skills with `triggers.json` shipped

| Skill | File |
|-------|------|
| triage | `skills/triage/triggers.json` |
| qa | `skills/qa/triggers.json` |
| review | `skills/review/triggers.json` |
| investigate | `skills/investigate/triggers.json` |
| implement | `skills/implement/triggers.json` |
| spec-author | `skills/spec-author/triggers.json` |

### CLI

```bash
# Run the loop for a skill
pnpm goose skill triggers <skill-name>

# JSON output for CI integration
pnpm goose skill triggers <skill-name> --json
```

Any skill with `triggers.json` is tested in CI. Build fails if `accuracy < 0.8`.

### Skill-coach integration

`runDescriptionLoop` failure list is consumed by the skill-coach (M11.13). On
convergent description-trigger failures across multiple runs, the coach proposes
a description diff via the existing improvement-candidate mechanism.

## Vertical surfaces touched

- **`core/learning/description-loop.ts`** — core loop logic
- **`skills/*/triggers.json`** — trigger sets for 6 skills
- **`apps/cli/src/index.ts`** — `goose skill triggers <skill>` command

## Running the tests

```bash
pnpm test slices/description-loop/slice.test.ts
```

Includes a suite that validates all 6 shipped `triggers.json` files against
the validator and runs the loop end-to-end.
