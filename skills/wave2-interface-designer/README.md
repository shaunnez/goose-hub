# skills/wave2-interface-designer

Wave-2 deep agent. Consumes cross-validated Wave-1 scout reports and emits **paste-ready** interface artefacts: Zod schemas, function signatures, SQL DDL, TypeScript interfaces. **No pseudocode.**

| File | Purpose |
|---|---|
| `prompt.md` | Paste-ready discipline + decision-summary expectations |
| `schema.ts` | `Wave2InterfaceDesignerSchema` — `artefacts[] + openQuestions[] + decisionSummaries[]` |
| `skill.config.ts` | `read` bundle, `freshContext: true`, sonnet-tier |
| `slice.test.ts` | Schema acceptance + paste-ready rejection on empty body |

Dispatched by the parent investigate flow after `crossValidate()` confirms the wave is consistent (M19.01, ADR 0030).
