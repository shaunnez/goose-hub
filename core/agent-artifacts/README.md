# core/agent-artifacts

Stores large or reusable agent-run payloads in SQLite and returns small artifact references for event payloads.

## Files

| File | Exports |
|---|---|
| `types.ts` | `ArtifactRef`, `StoredArtifact`, `InlinePayload`, and `MaybeStoredPayload` result shapes. |
| `repository.ts` | `storeArtifact`, `getArtifact`, list helpers, `maybeStoreLargePayload`, and `deterministicArtifactKey`. |

## Behaviour

- `storeArtifact` redacts secrets before persistence, serializes payloads as JSON, and upserts by `artifactKey`.
- `maybeStoreLargePayload` keeps payloads inline below `DEFAULT_ARTIFACT_THRESHOLD_BYTES` and stores larger payloads as artifact refs.
- `getArtifact` and list helpers omit expired artifacts.
- Artifact rows are scoped by `projectId`, optional `workItemId`, `runId`, and `kind`.

## Use

Use this module when an event or workflow result would otherwise carry bulky raw material. Keep event payloads small and durable by storing the large value here and emitting the returned `ArtifactRef`.
