# Wave 2 / Timeline Cost-Performance Handoff

## Issue #1001 - Prompt guardrails for Wave 2 and scout read discipline

- Branch name: `cost-perf/1001-prompt-guardrails`
- PR number/url: #1002 - https://github.com/shaunnez/goose-hub/pull/1002
- Parent branch: `main`
- Files changed:
  - `core/agent-runtime/runtime-instructions.ts`
  - `core/agent-runtime/runtime-instructions.test.ts`
  - `skills/scout-code-path/prompt.md`
  - `skills/scout-dependency/prompt.md`
  - `skills/scout-pattern/prompt.md`
  - `skills/scout-schema/prompt.md`
  - `skills/scout-test-inventory/prompt.md`
  - `skills/scout-test-inventory/slice.test.ts`
  - `skills/scout-tool-boundary.test.ts`
  - `skills/scout-user-journey/prompt.md`
  - `skills/wave2-interface-designer/prompt.md`
  - `skills/wave2-interface-designer/slice.test.ts`
  - `skills/wave2-risk-analyst/prompt.md`
  - `skills/wave2-risk-analyst/slice.test.ts`
- Tests run:
  - `pnpm vitest run core/agent-runtime/runtime-instructions.test.ts skills/wave2-interface-designer/slice.test.ts skills/wave2-risk-analyst/slice.test.ts skills/scout-tool-boundary.test.ts skills/scout-test-inventory/slice.test.ts`
  - `pnpm skill-contract:audit`
  - `pnpm audit-docs`
- Remaining risks:
  - Prompt-only guardrails cannot prove cost reduction until #994 telemetry lands.
  - `wave2-interface-designer` references `<scoutDigest>` as forward-compatible guidance, but the runtime still passes raw `<scoutReports>` until #1000.
- Notes:
  - Created dedicated issue #1001 because the prompt-guardrail work from `wave2-and-timeline-analysis.md` did not have an existing issue. This was implemented before #994 rather than folded into telemetry.
- Next branch to create: `cost-perf/994-tool-intensity-telemetry` from `cost-perf/1001-prompt-guardrails`
