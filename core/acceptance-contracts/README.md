# core/acceptance-contracts

Normalizes acceptance criteria and executable verification checks from the best available work-item source.

## Files

| File | Exports |
|---|---|
| `types.ts` | Zod schemas and TypeScript types for acceptance criteria, executable checks, acceptance contracts, and verify-command contracts. |
| `issue-body.ts` | `parseIssueBodyAcceptanceCriteria`, `parseIssueBodyVerifyCommands`, and `acceptanceCriteriaToVerifyCommands` for checklist-style issue bodies. |
| `resolver.ts` | `resolveAcceptanceContract(input)` for selecting the current acceptance contract for a work item. |

## Source Order

`resolveAcceptanceContract` returns the first usable contract in this order:

1. Latest `acceptance.contract-authored` event.
2. Persisted engineering spec criteria from `core/engineering-specs`.
3. Latest `prd.drafted` event.
4. Checklist acceptance criteria parsed from the issue body.

## Behaviour

- Criteria are normalized into stable `AC-*` IDs when authored IDs are absent.
- Executable checks keep pass/fail truth in commands, expected exit codes, evidence expectations, and timeouts.
- Deprecated legacy fields such as `verifyCommand`, `expected`, and `tolerance` are still read as input compatibility, but new contracts should use `executableChecks`.
