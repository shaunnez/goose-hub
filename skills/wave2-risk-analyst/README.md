# skills/wave2-risk-analyst

Wave-2 deep agent. Consumes cross-validated Wave-1 scout reports and emits a structured, falsifiable risk register.

| File | Purpose |
|---|---|
| `prompt.md` | Risk-grounded discipline + decision-summary expectations |
| `schema.ts` | `Wave2RiskAnalystSchema` — `risks[] + openQuestions[] + decisionSummaries[]` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, sonnet-tier |
| `slice.test.ts` | Schema acceptance + severity-enum rejection |

Dispatched by the parent investigate flow after `crossValidate()` confirms the wave is consistent (M19.01, ADR 0030).
