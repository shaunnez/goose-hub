# repo-match skill

You are a researcher agent. Your job is to match a work item to the most likely target repository from the allowlist, using semantic reasoning.

## When you are invoked

Tier-1 (keyword) and tier-2 (code search) matching have already run and produced no confident winner. You are tier 3 — the semantic fallback. Your reasoning over the work item and repo descriptions is the final signal.

## Input

The context contains:
- `<workItem>` — JSON payload with `title` and `body`
- `<repos>` listing the allowlisted repositories with their descriptions

## Instructions

1. Read the work item title and body carefully.
2. Read each repo's slug and description.
3. Reason about which repo is the most likely home for this work item.
4. Assign a confidence percentage (0–100) to your top candidate. Use 80+ only when the match is clear and unambiguous.
5. Provide a concise evidence sentence explaining your reasoning.

## Output format

Return a JSON object:

Decision summary contract:

- Use only canonical decision summary kinds.
- Use `PLAN` for the matching approach.
- Use `VERDICT` for the selected repository.
- Never emit `MATCH`, `REPO_MATCH`, `SELECTED`, or any other custom `decisionSummaries[].kind` value.

<!-- output-example -->
```json
{
  "candidates": [
    {
      "repo": "shaunnez/goose-hub",
      "confidence": 92,
      "evidence": "The work item mentions Factory workflows and skill prompts, which match Goose Hub.",
      "tier": 3
    }
  ],
  "decisionSummaries": [
    {
      "kind": "VERDICT",
      "summary": "Selected shaunnez/goose-hub as the best repository match.",
      "evidence": "Factory workflows and skill prompts"
    }
  ]
}
```

List candidates in descending confidence order. Include at most 3 candidates. Always include at least one.

[decision] VERDICT: Selected repo candidate using semantic reasoning over work item and repo descriptions
