# slices/stack-detector

Stack detector for target project repositories. Closes M12.01 (#304).

## What it does

Given a local path to a repository, `detectStack(repoPath)` inspects the
directory for well-known manifest files and returns a typed `StackInfo` object
describing the stack. Detection is purely file-system-based — no network
requests, no subprocesses.

## Vertical surfaces touched

- **Core lib**: `core/bootstrap/stack-detector.ts`
  - `detectStack(repoPath: string): Promise<StackInfo>` — public entry point
  - `StackInfo` — discriminated union covering `node | python | go | rust | ruby | unknown`

## Detection logic

Detectors run in priority order. The first match wins:

| Priority | Stack  | Manifest file(s)                    | Extracted fields                              |
|----------|--------|-------------------------------------|-----------------------------------------------|
| 1        | Node   | `package.json`                      | scripts (build/test/lint/typecheck/e2e), packageManager (pnpm/yarn/npm) |
| 2        | Python | `pyproject.toml` or `requirements.txt` | testRunner (pytest/unittest), lintTool (ruff/flake8) |
| 3        | Go     | `go.mod`                            | moduleName, testCommand, buildCommand         |
| 4        | Rust   | `Cargo.toml`                        | crateName, testCommand, buildCommand          |
| 5        | Ruby   | `Gemfile`                           | testRunner (rspec/minitest)                   |
| —        | Unknown | (none of the above)                | `{ type: 'unknown' }`                         |

When multiple manifests are present (e.g. a Node project with a `requirements.txt`),
the highest-priority detector wins. Node beats Python, Python beats Go, etc.

## TOML / go.mod parsing

No TOML library is used. `pyproject.toml` and `Cargo.toml` are parsed with
targeted regex patterns. `go.mod` is parsed line-by-line. This avoids adding
heavyweight dependencies (FACTORY_RULES rule 27).

## Running the tests

```bash
pnpm vitest run slices/stack-detector/slice.test.ts
```

All tests use local fixture directories under `slices/stack-detector/fixtures/`.
No network or subprocess required.

## Test fixtures

| Fixture dir  | Contents                        | Expected result         |
|--------------|---------------------------------|-------------------------|
| `node/`      | `package.json` with pnpm        | `{ type: 'node', packageManager: 'pnpm', scripts: {...} }` |
| `python/`    | `pyproject.toml` (pytest+ruff)  | `{ type: 'python', testRunner: 'pytest', lintTool: 'ruff' }` |
| `python-req/`| `requirements.txt` only         | `{ type: 'python', testRunner: 'unittest' }` |
| `go/`        | `go.mod`                        | `{ type: 'go', moduleName: 'github.com/example/my-go-project', ... }` |
| `rust/`      | `Cargo.toml`                    | `{ type: 'rust', crateName: 'my-rust-crate', ... }` |
| `ruby/`      | `Gemfile` with rspec            | `{ type: 'ruby', testRunner: 'rspec' }` |
| `unknown/`   | `README.txt` (no manifest)      | `{ type: 'unknown' }` |
| `multi/`     | `package.json` + `requirements.txt` | `{ type: 'node' }` (priority wins) |
