# core/test-runner

Runs Vitest with the JSON reporter and parses the output into a runner-agnostic `TestRun` shape. The QA holdout consumes the parsed structure; nothing else should depend on Vitest's raw report shape.

## Files

| File | Exports |
|---|---|
| `run-vitest.ts` | `runVitest(opts): Promise<TestRun>` — spawns the test command via `sh -c`, appends `--reporter=json --outputFile=<tmp>`, reads back the tempfile, and returns the parsed `TestRun`. Default timeout 10 minutes. |
| `parse-vitest-json.ts` | `parseVitestJson(report): TestRun` — pure function over Vitest's JSON report. No I/O. |

## Why split

`parse-vitest-json.ts` is pure so unit tests can feed it captured fixtures without a Vitest install. `run-vitest.ts` handles the spawn-and-read dance and lets the parser stay deterministic.

## Calling convention

The test command is a single shell string (e.g. `pnpm test`). The runner strips any existing `--reporter` flag and re-injects `--reporter=json --outputFile=<tempfile>`. Stdout is reserved for log output; the JSON report goes to disk. The tempfile is cleaned up regardless of success or failure.

## Consumers

- `skills/qa` — feeds `TestRun` into structural-tier checks.
- `core/verify` — uses both modules from `tiers.ts` to score functional and regression tiers.
