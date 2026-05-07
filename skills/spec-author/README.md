# skills/spec-author

Authors the **Engineering Spec** for a work item — the structured plan artefact consumed by parallel-builder (M19.03) and convergent-review (M19.04). M19.02 (#559) replaced this skill's prior Playwright-spec implementation; the skill name was always Engineering-Spec-shaped (see `triggers.json`), only the prompt + schema lagged behind. PLAN.md §28 (M19) names this skill explicitly as the spec author.

Read-only — outputs a single JSON object conforming to `EngineeringSpecSchema`. Persistence to `slices/<n>/spec.json` is orchestrator-side after schema + structural validation pass.

| File | Purpose |
|---|---|
| `prompt.md` | Authoring discipline: 8 steps, 12 required sections, hard rules |
| `schema.ts` | `EngineeringSpecSchema` — objective + journeys + ACs + WPs + execution-order DAG + verification tooling + AC→Journey→Verification map + constraints + risks |
| `validate.ts` | `validateEngineeringSpec()` — file-ownership / AC-orphan / risk-on-auth / constraint-citation rules + Steve's 6 self-checks |
| `skill.config.ts` | `read` bundle, sonnet-tier, role: developer |
| `slice.test.ts` | Schema acceptance + every rejection rule covered |
| `triggers.json` | Layer-1 description-loop triggers |

## Hard rules (validator-enforced)

| Rule | What it checks |
|---|---|
| `file-ownership-collision` | Same path cannot appear in two WPs' `filesOwned` (full-stop, not per-batch) |
| `ac-orphan-without-journey` | For `issueType: feature`, every AC has `journeyRef` or `crossCutting: true` |
| `ac-journey-ref-not-found` | `journeyRef` must point at a real journey; `stepIdx` must be a real step |
| `risk-required-on-sensitive-path` | Touching `auth\|session\|crypto\|secret` → ≥1 entry in `riskRegister` |
| `constraint-source-format` | Constraint `source` must be `path:line` or `path:symbol` |
| `constraint-source-file-missing` | (when `repoRoot` provided) cited file must exist |
| `constraint-source-symbol-missing` | (when `repoRoot` provided) cited symbol must appear in the file |
| `wp-dependson-not-found` | `dependsOn` references must point at real WPs |
| `execution-order-wp-mismatch` | Every WP appears in exactly one batch |
| `self-check-journey-coverage` | Every journey step has ≥1 AC |
| `self-check-grounded-in-code` | (when `repoRoot` provided) WPs whose parent dirs exist but files don't may be typos |
| `self-check-complete-interfaces` | ≥2 WPs ⇒ ≥1 `interfaceContracts` entry |
| `self-check-builder-independence` | `changes` field non-trivial |
| `self-check-verification-tooling` | >2 WPs ⇒ ≥1 `verificationTooling` entry |

## Wave-protocol composition (M19.01)

When the swarm (M19.01) is wired into the production workflow, the orchestrator passes Wave-1 scout reports + Wave-2 deep-agent reports to this skill via `<scout_reports>` and `<wave2_reports>`. The author cites scout findings (file:line) in `architecture`, `interfaceContracts`, and `constraints`. When the swarm is **not** wired (current default in M19.01), the author falls back to manual investigation via the `read` tool bundle — the spec format does not require the swarm to be implementable.

## Cross-references

- Issue #559 (M19.02)
- PLAN.md §28 (M19) — Engineering Spec named in the milestone scope
- Steve `01-planning-phase.md:282-327` — Engineering Spec format + self-checks
- Steve `03-lifecycle-harness.md:145-157` — Work Package system + file-ownership rule
- Steve `Plan Examples/` — 4 worked examples (auth-comprehensive-audit, clean-schema-architecture, platform-compiler-phase-b, ws-architecture-polish)
- ADR 0022 — skill file convention
- ADR 0030 (M19.01) — sub-agent dispatch from skills (Wave-1/Wave-2)
