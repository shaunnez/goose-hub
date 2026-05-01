# skills/echo-test

Trivial echo-back skill used to prove the M4 runtime pipeline end-to-end.

The agent receives a `message` field in context and returns it in the `echo` field of the output JSON, along with one `decisionSummaries` entry.

## Files

| File | Purpose |
|------|---------|
| `prompt.md` | System prompt: instructions to echo the message |
| `schema.ts` | `EchoOutputSchema` (Zod) — `echo: string`, `decisionSummaries: DecisionSummary[]` |
| `skill.config.ts` | `SkillConfig` — sonnet, no tools, no fresh context |

## Usage

```bash
goose run-agent --skill=echo-test --input='{"message":"hello world"}'
```

Expected output:
```json
{ "echo": "hello world", "decisionSummaries": [{ "step": "echo", "summary": "Echoed input message" }] }
```
