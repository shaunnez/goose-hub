# core/prd

Reads the latest durable PRD artifact for a work item from the event stream.

## Files

| File | Exports |
|---|---|
| `read-model.ts` | `resolveLatestPrd(input)` plus result and input types for PRD read consumers. |

## Behaviour

- `resolveLatestPrd` replays `prd.drafted` events for a project/work item and returns the newest event containing a `prd` payload.
- The result includes the PRD payload, normalized advisor concerns, source metadata, creation time, and originating run ID.
- Advisor concerns may be authored as a string or string array; arrays are normalized into Markdown bullet text.
- A missing PRD returns `null`, leaving callers to decide whether to hide, block, or request PRD generation.

## Source Of Truth

The canonical PRD read path is the `prd.drafted` event stream. Do not reintroduce GitHub PRD comment scraping here; lifecycle comments and issue labels remain source-of-truth surfaces for workflow state, not PRD storage.
