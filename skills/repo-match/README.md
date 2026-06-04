# skills/repo-match

Matches a work item to the most likely target repository using a three-tier threshold-gated design.

## Tiers

| Tier | Method | Escalates when |
|------|--------|----------------|
| 1 | Keyword scoring against slug + description tokens | Top score confidence < threshold |
| 2 | GitHub code search API bounded to allowlisted repos | No candidate has a clear confidence lead |
| 3 | Semantic reasoning (Claude) over work item + repo descriptions | Only reached when tiers 1+2 fail |

## Inputs

`contextSchema` (`RepoMatchContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Work item title |
| `workItem.body` | `string` | Work item body / description |

## Outputs

`RepoMatchOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `candidates` | `RepoCandidateOutput[]` | Ranked repo candidates |
| `candidates[].repo` | `string` | Repo slug (`owner/name`) |
| `candidates[].confidence` | `number` | 0–100 confidence score |
| `candidates[].evidence` | `string` | Signal that drove the match |
| `candidates[].tier` | `1 \| 2 \| 3` | Tier that produced the match |
| `decisionSummaries` | `DecisionSummary[]` | Per-decision audit trail (min 1) |

## Allowlist config

Repo allowlist lives in `target-projects/<project-slug>/project.config.ts`.
`repos.md` is optional human/LLM context and may provide descriptions using this format:

```markdown
### [owner/slug](url)
**Description:** ...
```

## Keyword tier scoring weights

| Signal | Points |
|--------|--------|
| Slug token match in title | 10 |
| Slug token match in body | 3 |
| Description token match in title | 2 |
| Description token match in body | 1 |
| Full slug match bonus | 15 |
