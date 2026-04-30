# core/state-machine

Typed state machine for Goose Hub issue lifecycle management.

## Modules

### `states.ts`

Exports the canonical ordered list of 23 `factory:*` state names as a frozen `STATES` array, plus `StateName` (union type) and `State` (alias).

### `transitions.ts`

Exports the legal transition table:

- `legalTargets(from: StateName): readonly StateName[]` — returns all valid next states from `from`.
- `isLegalTransition(from: StateName, to: StateName): boolean` — returns `true` if the transition is in the table.

### `conflict-resolver.ts`

Resolves label conflicts when a GitHub issue carries multiple (or missing, or unknown) `factory:*` labels.

#### Exports

**`ConflictReason`** — union of possible conflict codes:

| Code | Meaning |
|---|---|
| `zero-factory-labels` | No known `factory:*` state labels found; defaulted to `factory:triaging` |
| `multiple-state-labels` | Two or more known state labels; highest canonical index wins |
| `unknown-factory-label` | A `factory:*` label was present but not in `STATES`; ignored |
| `archived-wins` | `factory:archived` present alongside another state; archived takes precedence |
| `illegal-transition` | The proposed transition is not in the legal transition table |

**`ConflictResult`** — `{ state: StateName; conflicts: ConflictReason[] }`

**`resolveState(labels: string[]): ConflictResult`** — applies the 5 label-conflict rules and returns the effective state plus any conflict codes.

**`checkTransition(from: StateName | null, to: StateName): { legal: boolean; reason: ConflictReason | null }`** — validates a single transition. `from === null` (no prior state) is always legal.

## Conflict resolution rules

1. Zero `factory:*` state labels → state = `factory:triaging`, conflict `zero-factory-labels`.
2. Unknown `factory:*` label (prefix present, not in `STATES`) → ignored, conflict `unknown-factory-label`.
3. `factory:archived` + any other state label → archived wins, conflict `archived-wins`.
4. Two or more known state labels → highest index in `STATES` wins, conflict `multiple-state-labels`.
5. Single known state label → no conflict.
