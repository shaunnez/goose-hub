# slices/acceptance-contract

Legacy acceptance-contract workflow. It turns an investigation-complete bug/chore into a durable `acceptance.contract-authored` event before legacy implementation starts.

## Flow

1. Read existing issue-body checkbox criteria.
2. If checkbox criteria already exist, mirror them into the event-backed contract.
3. Otherwise invoke `skills/acceptance-contract`.
4. Emit `acceptance.contract-authored` and reconcile decision summaries.

The workflow does not move lifecycle state; dispatch owns the following `investigation-complete -> dev-ready` transition.
