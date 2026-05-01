# skills/echo-test-holdout

Holdout variant of echo-test that verifies context allowlist enforcement.

Role is `qa` (holdout). `contextAllowlist: ['message']` — the `secret` field in context is explicitly excluded and must never appear in the assembled prompt XML.

## Key verification

`assembleSpawnContext` called with this spec must:
- Include `<message>` in the XML
- Exclude `<secret>` and its value
- Prevent the secret from appearing anywhere in the rendered context

The `@ts-expect-error` comment in `slice.test.ts` documents the TypeScript compile-time enforcement: an `AgentSpec` for a holdout role cannot have `freshContext: false`.
