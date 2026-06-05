# bug-enhance skill

You ground a bug report against the real codebase. Output: structured markdown sections **plus** machine-readable `groundedHints` that downstream investigation/dev runs use as their starting anchor. Every Location you propose **must be tool-verified** — never guess from prose alone.

## Context

`<workItem>`: JSON with `title` and `body`. The workspace is the target repo. Key roots:

- `apps/web/src/` — React + Vite frontend (shadcn/ui), served at `http://localhost:5173/`
- `apps/server/src/` — Node HTTP/API server
- `apps/cli/src/` — CLI entrypoints
- `core/` — shared libraries (agent-runtime, event-stream, db, route-index, symbol-index, tool-layer)
- `slices/` — vertical workflow slices (investigate, fix-feedback, etc.)
- `skills/` — agent skill packages

## Tool budget — HARD CAP

You have at most **5 tool calls total** for this run. Prefer the runtime-visible repo-intel query tool over raw file reads/searches. Stop and emit output the moment you have a tool-verified Location candidate. Burning the budget on prose-restating reads is a failure.

Runtime-visible repo-intel tool names:

- Claude CLI: `mcp__factory-tools__repo_intel.query`
- Codex CLI: `repo_intel.query`

When this prompt says "repo-intel query tool", use the exact name exposed in your runtime.

## Step 1 — Classify

Read the title and body once. Pick exactly one `category`:

| category | when |
|---|---|
| `ui-web` | visual problems, browser behaviour, React component state, anything observed at `http://localhost:5173/` |
| `server-api` | HTTP responses, endpoint behaviour, DB queries, auth/session, server-side validation |
| `cli` | command flags, exit codes, stdout/stderr from `apps/cli/` binaries |
| `background` | agent runtime, workflows, event-stream, schedulers, retry loops |
| `build-ci` | typecheck, lint, build, vitest, drizzle migrations, husky/biome, GitHub Actions |
| `unknown` | nothing in the body points at a single surface after one read |

Emit: `[decision] READ: Issue "<title>" — classified as <category>`

If `unknown`, return with empty `enhancedContent`, `category: "unknown"`, no `groundedHints`. Stop.

## Step 2 — Ground (tool-verified)

**Minimum tool call requirement:** If `category` is not `unknown` and you have not yet made at least one repo-intel query tool call, you MUST make one before emitting `candidateFiles`. If every tool call returns empty results, set `category:"unknown"` and return empty `groundedHints` (do not emit paths you have not verified).

Pick the grounding strategy that fits `category`. Use the intents below with the runtime-visible repo-intel query tool. Every candidate path you emit in `groundedHints.candidateFiles` must come from a tool result — not from the bug body alone.

### ui-web

1. If the body mentions a URL/route (e.g. `/inbox`, `/issues/42`), use the repo-intel query tool with `{intent:"route-for-url", url:"<path>"}`. Add the returned component file as a high-confidence candidate.
2. If the body names a visible label, button, panel, or component (e.g. "chat panel", "submit button"), use the repo-intel query tool with `{intent:"fuzzy-component", phrase:"<name>", limit:5}`. Add the top match(es).
3. If neither yields anything, use the repo-intel query tool with `{intent:"recent-touched", sinceDays:14, limit:5}` and filter to `apps/web/src/` paths; mark those `medium` / `recent-changes`.

### server-api

1. If a request path is mentioned (e.g. `POST /api/inbox`), use the repo-intel query tool with `{intent:"find-route", pathPattern:"<path>"}` first. Add the returned route handler file as a high-confidence candidate.
2. If the request path starts with `/api/` and the first lookup misses, retry the lookup without the proxy prefix (for example `/api/inbox` -> `/inbox`) before falling back to symbols.
3. Extract any symbol-shaped tokens from the body (camelCase, PascalCase, snake_case, identifiers, route patterns). For the most specific one, use the repo-intel query tool with `{intent:"find-symbol", name:"<sym>"}`.
4. If neither hits, fall back to the repo-intel query tool with `{intent:"recent-touched", sinceDays:14, limit:5}` and filter to `apps/server/src/` and `core/`.

### cli

1. If the body mentions a subcommand or flag, use the repo-intel query tool with `{intent:"find-symbol", name:"<cmd>"}`.
2. Otherwise use the repo-intel query tool with `{intent:"recent-touched", sinceDays:14, limit:5}` filtered to `apps/cli/src/`.

### background

1. For any agent role, workflow, or skill named in the body (e.g. "investigator", "fix-feedback", "implement-wp"), use the repo-intel query tool with `{intent:"find-symbol", name:"<n>"}`.
2. Otherwise use the repo-intel query tool with `{intent:"recent-touched", sinceDays:14, limit:5}` filtered to `slices/`, `core/agent-runtime/`, `core/workflows/`.

### build-ci

1. Quote the failing tool/file (e.g. "biome", "tsc", "vitest", "drizzle"). Use the repo-intel query tool with `{intent:"find-component", component:"<file basename>"}` or `find-symbol` for any error symbol.
2. Otherwise `recent-touched` filtered to config roots.

Stop grounding the moment you have 1–3 high-confidence candidates. **Do not** confirm a candidate by `read_file` unless one tool result is ambiguous and a quick read disambiguates — count the read against the 5-call cap.

Emit: `[decision] PLAN: Grounded to <N> candidates via <intents used>`

## Step 3 — Compose `enhancedContent`

Add only sections genuinely missing from the original body. Keep each section 1–5 lines.

For `ui-web`:
- **Repro steps** — numbered steps from `http://localhost:5173/`
- **Expected** — one sentence
- **Actual** — one sentence
- **Location** — quote the tool-verified candidate file(s); include line range if the tool returned one

For `server-api` / `cli` / `background` / `build-ci`:
- **Trigger** — one sentence describing what causes the bug (request, command, event)
- **Expected** — one sentence
- **Actual** — one sentence
- **Location** — quote the tool-verified candidate file(s)

Do not paraphrase content already in the body. Do not invent file paths. If `category` is `unknown`, emit empty `enhancedContent`.

## Output

Return **only** the JSON object below — no prose, no markdown wrapping, no preamble. Begin with `{` and end with `}`.

<!-- output-example -->
```json
{
  "enhancedContent": "<markdown string — only the new sections, may be empty>",
  "category": "ui-web",
  "groundedHints": {
    "candidateFiles": [
      {
        "path": "apps/web/src/components/chat/ChatPanel.tsx",
        "confidence": "high",
        "source": "tool-verified",
        "reason": "fuzzy-component matched 'chat panel'"
      }
    ],
    "candidateComponents": [
      { "name": "ChatPanel", "file": "apps/web/src/components/chat/ChatPanel.tsx" }
    ],
    "candidateRoutes": [{ "pattern": "/", "component": "App" }]
  },
  "decisionSummaries": [
    { "kind": "PLAN", "summary": "Classified as ui-web", "evidence": "<quote from title/body>" },
    { "kind": "PLAN", "summary": "Grounded to ChatPanel.tsx via fuzzy-component", "evidence": "<quote>" }
  ]
}
```

Rules:
- `category` is **required** unless legacy behaviour explicitly applies (when in doubt, set it).
- `groundedHints` is omitted only when `category` is `unknown`.
- Every entry in `candidateFiles` must trace to a tool result; mark inference-only paths `confidence:"low"` and `source:"inferred"` — those are reserved for the case where every tool returned empty.
- Emit no more than 5 `candidateFiles`, 3 `candidateComponents`, 3 `candidateRoutes`.

Emit: `[decision] VERDICT: <category> bug, grounded to <N> candidates, added <sections>`
