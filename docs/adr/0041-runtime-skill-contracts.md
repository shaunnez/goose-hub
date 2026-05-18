# ADR 0041: Runtime Skill Contracts

- Status: Accepted
- Date: 2026-05-15

## Context

Runtime skills have three contract surfaces that must agree:

1. Input context rendering (`skill.config.ts` `contextSchema` + `contextAllowlist`, rendered by `context-renderer.ts`).
2. Prompt contract (`skills/<name>/prompt.md`).
3. Output contract (`skills/<name>/schema.ts`, consumed by workflows as JSON objects).

Existing drift includes snake_case prompt tags while the renderer emits camelCase tags from allowlist keys.

## Decision

1. **Canonical names are camelCase** for rendered XML context tags and output JSON fields.
2. **Renderer behavior stays stable** for this migration: dotted allowlist entries render JSON payloads in top-level tags (no nested XML migration).
3. **Output field renames are hard migrations** within each workflow-family batch: schema, prompt examples, consumers, mocks, and tests must move together.
4. **Migration is family-batched**, not a monolithic sweep.
5. Add an **auditor first**:
   - advisory reporting by default,
   - fail-capable deterministic drift checks enabled family-by-family as families are cleaned.

## Consequences

- Skill prompts must reference input tags exactly as rendered from `contextAllowlist`.
- Prompt JSON examples must match schema fields exactly.
- Consumer inventory is part of the contract surface and must be visible in audit output.
- Runtime contract drift becomes measurable before being enforced.
