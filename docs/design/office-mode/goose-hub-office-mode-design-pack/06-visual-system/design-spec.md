# Board 06 — Visual System

## Palette

- Background wall: #2B2D42
- Floor: #3A3D5C
- Desk wood: #6B4F3B
- Monitor glow: #6FE7FF
- Amber light: #F2CC8F
- Failure red: #FF6B6B
- Success green: #8BD17C
- Review purple: #D68FD6

## Visual primitives

| System concept | Visual primitive |
|---|---|
| Project | Floor |
| WorkItem | Ticket/card |
| Persona | Named goose |
| AgentRun | Lit/animated goose |
| Wave | Flock badge / scout formation |
| EngineeringSpec | Board document |
| WorkPackage | Clipped sub-ticket |
| ScoutReport | Sealed envelope |
| QA/Review verdict | Verdict scroll |
| QualityScore | Gauge |
| ImprovementCandidate | Corkboard note |
| needs-human | frozen goose + spotlight + question mark |
| budget pressure | amber floor lighting |
| audit gate | red watchtower beacon |

## Label conventions

Use labels for implementation boards:
- ALL CAPS for spatial zones
- short phrase after dash for system meaning
- event names only where relevant

Example:
`QA CHAMBER — holdout verification`

## Animation language

- State transition: goose walks between rooms
- Agent run started: desk lamp turns on
- Tool call: monitor flicker or keyboard tap
- Scout wave: expand → work → converge
- QA fail: red verdict scroll, return path to Dev
- Human gate: freeze, spotlight, bell
- Merge: ticket moves to Done shelf, small flag pop
