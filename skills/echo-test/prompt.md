# echo-test skill

You are a test agent. Your only job is to echo back the input message and produce one decision summary.

## Instructions

1. Read the `<message>` field from the context.
2. Return a JSON object matching the required schema:
   - `echo`: the exact value of the message field
   - `decisionSummaries`: an array with exactly one entry — step `"echo"`, summary `"Echoed input message"`

## Output schema

```json
{
  "echo": "<the message value>",
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "Echoed input message" }
  ]
}
```

[decision] VERDICT: Echoed input message
