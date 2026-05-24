# 1021–1023 Failure Cascade — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate three cascading failure modes observed on issues 1021–1023: (G1) codex `resources/read` returns `-32603 Invalid URL` and aborts runs, (G2) spec-author authors WPs with hallucinated file paths, (G3) fix-feedback rejects valid repair output because `evidenceSpecPath` context is lost across cycles.

**Architecture:** Three independent fixes shipped as separate PRs. G1 widens the F5 converter to accept the URI shapes codex actually emits (`read_file?path=…`, `file_exists?path=…`) and demotes the `BLOCKED_RUNTIME_SURFACE_PATTERNS` entry for `resources/read failed` to advisory — codex’s probe is expected behavior under F5, not a fatal surface. G2 grounds the spec-author by injecting an existing-file manifest for the directories its prompt is going to cite, and promotes `self-check-grounded-in-code` from full-WP-missing to per-file. G3 forwards prior `evidenceSpecPath` from the most recent `agent.implement-complete` (or `agent.fix-feedback-complete`) event into the fix-feedback context so repair runs that touch `apps/web/` re-use the dev cycle’s spec instead of returning `null`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` 1.29, Zod, Vitest, eventStore (SQLite-backed), workspace path-policy.

---

## File Structure

**G1 — codex MCP resources/read converter (Issue A)**

- Modify: `core/tool-layer/mcp/tools/resources.ts` — extend `uriToWorkspaceRelative` and split into dispatch fn that emits a tagged operation (`read | exists`).
- Modify: `core/tool-layer/mcp/server.ts:133-142` — replace high-level `server.resource(...)` registration with low-level `server.server.setRequestHandler(ReadResourceRequestSchema, ...)` so we own URI parsing before SDK `new URL()` validation fires.
- Modify: `core/agent-runtime/codex-cli.ts:78-84` — remove `'resources/read failed'` from `BLOCKED_RUNTIME_SURFACE_PATTERNS`; surface it as an audit event only.
- Modify: `core/tool-layer/mcp/resources.test.ts` — add cases for tool-shaped URIs and round-trip dedupe with `read_file`.
- Modify: `core/agent-runtime/codex-cli-runtime.test.ts:480-495` — flip the existing test that asserts `resources/read failed` is fatal; it should now record an `agent.runtime-advisory` event and NOT mark `block_reason`.

**G2 — spec-author grounding (Issue B)**

- Modify: `skills/spec-author/skill.config.ts` — add optional `existingFileManifest` field to `SpecAuthorContextSchema` + allowlist entry.
- Modify: `skills/spec-author/prompt.md` — document the manifest, require WP `filesOwned` to either appear in the manifest or be flagged with explicit `kind: "new"` annotation.
- Modify: `skills/spec-author/schema.ts` — add per-file annotation field on WP (`{ path: string; status?: 'existing' | 'new' }`) keeping `path: string` shorthand backward-compatible.
- Modify: `skills/spec-author/validate.ts:373-394` — replace the soft "WP entirely missing" check with a per-file rule that errors on any non-existent file under `apps/`, `core/`, `slices/`, `skills/` unless that file's WP entry is annotated `status: 'new'`.
- Create: `skills/spec-author/manifest.ts` — `collectScopeManifest(repoRoot, scopeRoots): {path: string, kind: 'file' | 'dir'}[]` capped at 800 entries; reuses path-policy denylist.
- Modify: workflow that invokes `spec-author` (locate via `grep -rn "skill: 'spec-author'"`) — call `collectScopeManifest` for the scopeRoots inferred from `<scoutReports>` / `<investigationSynthesis>` / `<prdContext>` and pass into context.
- Add: `skills/spec-author/manifest.test.ts` + extend `skills/spec-author/validate.test.ts` with new per-file rule cases.

**G3 — fix-feedback forwards prior `evidenceSpecPath` (Issue C)**

- Modify: `slices/fix-feedback/workflow.ts:451-499` — read `evidenceSpecPath` from the most recent `agent.implement-complete` or `agent.fix-feedback-complete` event for the work item; inject into context as `priorEvidenceSpecPath`; add to `contextAllowlist`.
- Modify: `skills/implement/skill.config.ts` — add optional `priorEvidenceSpecPath: z.string().nullable().optional()` to context schema + allowlist.
- Modify: `skills/implement/prompt.md` — single short bullet under §evidence: when `priorEvidenceSpecPath` is present and changes still touch `apps/web/`, reuse it unless the prior spec is now stale; otherwise author a new one or emit `SKIP_GATE`.
- Modify: `slices/fix-feedback/slice.test.ts` — add a regression case asserting `priorEvidenceSpecPath` propagation.

---

## Task Index

| Task | Goal | Surface | Risk |
|---|---|---|---|
| 1 | Widen MCP resources/read converter to handle codex tool-shaped URIs | `core/tool-layer/mcp/tools/resources.ts` + tests | low |
| 2 | Switch server registration to low-level `setRequestHandler` so we control URL parsing | `core/tool-layer/mcp/server.ts` | low–med (SDK surface) |
| 3 | Demote `resources/read failed` blocking pattern to advisory | `core/agent-runtime/codex-cli.ts` + tests | low |
| 4 | Add `collectScopeManifest` helper | `skills/spec-author/manifest.ts` + test | low |
| 5 | Wire manifest into spec-author context | spec-author config + invoker workflow | low |
| 6 | Promote `self-check-grounded-in-code` to per-file rule | `skills/spec-author/validate.ts` + tests | low |
| 7 | Forward `priorEvidenceSpecPath` through fix-feedback | `slices/fix-feedback/workflow.ts` + implement skill + tests | low |

Each task ends with a commit. Tasks 1–3 are G1, 4–6 are G2, 7 is G3. G1 ships first since it unblocks observability for G2/G3 changes.

---

### Task 1: Widen MCP `resources/read` URI converter

**Files:**
- Modify: `core/tool-layer/mcp/tools/resources.ts`
- Modify: `core/tool-layer/mcp/resources.test.ts`

- [ ] **Step 1: Add failing test cases for codex tool-shaped URIs**

Append inside the existing `describe('uriToWorkspaceRelative', ...)` block (file: `core/tool-layer/mcp/resources.test.ts`):

```ts
it('handles codex read_file?path=… URI form', () => {
  expect(uriToWorkspaceRelative('read_file?path=package.json')).toEqual({
    op: 'read',
    path: 'package.json',
  });
});

it('handles codex file_exists?path=… URI form', () => {
  expect(uriToWorkspaceRelative('file_exists?path=apps/web/src/components/chat/components/ChatDock.tsx')).toEqual({
    op: 'exists',
    path: 'apps/web/src/components/chat/components/ChatDock.tsx',
  });
});

it('url-decodes percent-encoded paths in tool-shaped URIs', () => {
  expect(uriToWorkspaceRelative('read_file?path=apps%2Fweb%2Fsrc%2Findex.ts')).toEqual({
    op: 'read',
    path: 'apps/web/src/index.ts',
  });
});

it('keeps bare path / factory:// / file:// forms as read', () => {
  expect(uriToWorkspaceRelative('factory://core/types.ts')).toEqual({ op: 'read', path: 'core/types.ts' });
  expect(uriToWorkspaceRelative('file:///core/types.ts')).toEqual({ op: 'read', path: 'core/types.ts' });
  expect(uriToWorkspaceRelative('core/types.ts')).toEqual({ op: 'read', path: 'core/types.ts' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run core/tool-layer/mcp/resources.test.ts`
Expected: 4 new tests fail — current `uriToWorkspaceRelative` returns `string`, not `{op, path}`.

- [ ] **Step 3: Replace converter return type with tagged op**

Edit `core/tool-layer/mcp/tools/resources.ts`:

```ts
const FACTORY_URI_PREFIX = 'factory://';
const TOOL_URI_RE = /^(read_file|file_exists)\?path=(.+)$/;

export type ResourceOp = { op: 'read'; path: string } | { op: 'exists'; path: string };

export function uriToWorkspaceRelative(uri: string): ResourceOp {
  const toolMatch = TOOL_URI_RE.exec(uri);
  if (toolMatch != null) {
    const op = toolMatch[1] === 'file_exists' ? 'exists' : 'read';
    return { op, path: decodeURIComponent(toolMatch[2]) };
  }
  if (uri.startsWith(FACTORY_URI_PREFIX)) {
    return { op: 'read', path: uri.slice(FACTORY_URI_PREFIX.length) };
  }
  const fileMatch = /^file:\/\/\/?(.*)$/.exec(uri);
  if (fileMatch != null) {
    return { op: 'read', path: fileMatch[1] };
  }
  return { op: 'read', path: uri };
}
```

- [ ] **Step 4: Update `readWorkspaceResource` to dispatch on op**

Edit `core/tool-layer/mcp/tools/resources.ts`:

```ts
export async function readWorkspaceResource(
  ctx: FactoryContext,
  uri: URL | string,
): Promise<ReadResourceResult> {
  const uriStr = typeof uri === 'string' ? uri : uri.toString();
  const parsed = uriToWorkspaceRelative(uriStr);
  const auditBase = { tool_name: 'resources/read', uri: uriStr, relativePath: parsed.path, op: parsed.op };

  try {
    if (parsed.op === 'exists') {
      const result = await fileExistsTool(ctx, { path: parsed.path });
      eventStore.appendEvent({
        projectId: ctx.projectId,
        workItemId: ctx.workItemId,
        runId: ctx.runId,
        personaId: ctx.personaId ?? null,
        kind: 'agent.tool-call',
        payload: { ...auditBase, status: 'ok' },
      });
      return {
        contents: [{
          uri: workspaceRelativeToUri(result.path.path),
          mimeType: 'application/json',
          text: JSON.stringify({ exists: result.exists, path: result.path.path }),
        }],
      } satisfies ReadResourceResult;
    }
    const result = await readFileTool(ctx, { path: parsed.path });
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.tool-call',
      payload: {
        ...auditBase,
        status: 'ok',
        cached: (result as { cached?: boolean }).cached ?? false,
      },
    });
    const canonicalUri = workspaceRelativeToUri(result.path?.path ?? parsed.path);
    return {
      contents: [{ uri: canonicalUri, mimeType: 'text/plain', text: result.content }],
    } satisfies ReadResourceResult;
  } catch (err) {
    eventStore.appendEvent({
      projectId: ctx.projectId,
      workItemId: ctx.workItemId,
      runId: ctx.runId,
      personaId: ctx.personaId ?? null,
      kind: 'agent.tool-call',
      payload: {
        ...auditBase,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
```

Add a top-level import: `import { fileExistsTool } from './read.js';`.

- [ ] **Step 5: Add resources/read dispatch test that exercises `exists`**

Append to `core/tool-layer/mcp/resources.test.ts` inside `describe('resources/read', ...)`:

```ts
it('routes file_exists?path=… via fileExistsTool and serializes { exists: bool }', async () => {
  const ctx = makeTestContext(); // existing helper in this file
  const result = await readWorkspaceResource(ctx, 'file_exists?path=package.json');
  expect(result.contents[0].mimeType).toBe('application/json');
  expect(JSON.parse(result.contents[0].text as string)).toEqual({
    exists: true,
    path: 'package.json',
  });
});

it('routes file_exists for a missing path and reports exists:false (no throw)', async () => {
  const ctx = makeTestContext();
  const result = await readWorkspaceResource(ctx, 'file_exists?path=does-not-exist.ts');
  expect(JSON.parse(result.contents[0].text as string)).toMatchObject({ exists: false });
});

it('shares run-cache with read_file for the same canonical path', async () => {
  const ctx = makeTestContext();
  await readFileTool(ctx, { path: 'package.json' });
  const result = await readWorkspaceResource(ctx, 'read_file?path=package.json');
  // The audit event should be marked cached:true on the second read.
  const events = eventStore.replay({ workItemId: ctx.workItemId });
  const last = events.findLast((e) => (e.payload as any).tool_name === 'resources/read');
  expect((last?.payload as any).cached).toBe(true);
  expect(result.contents[0].text).toBeDefined();
});
```

- [ ] **Step 6: Run all resources tests**

Run: `pnpm vitest run core/tool-layer/mcp/resources.test.ts`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add core/tool-layer/mcp/tools/resources.ts core/tool-layer/mcp/resources.test.ts
git commit -m "fix(mcp): support codex tool-shaped URIs in resources/read

read_file?path=… and file_exists?path=… now route through the existing
read_file / file_exists pipelines, share the per-run cache, and emit the
same agent.tool-call audit event. Resolves -32603 Invalid URL aborts
observed on issues 1022 and 1023."
```

---

### Task 2: Switch MCP server to low-level `setRequestHandler` for resources/read

**Files:**
- Modify: `core/tool-layer/mcp/server.ts`
- Modify: `core/tool-layer/mcp/resources.test.ts`

The high-level `server.resource(..., ResourceTemplate, ...)` call performs `new URL(uri)` before invoking our callback, so non-URL strings like `read_file?path=…` still fail at SDK boundary even after Task 1. Bypass via the low-level handler.

- [ ] **Step 1: Add failing test for raw URI passthrough**

Append inside `describe('resources/read', ...)` in `core/tool-layer/mcp/resources.test.ts`:

```ts
it('does not throw "Invalid URL" when called with read_file?path=… via the server transport', async () => {
  const server = buildFactoryMcpServer(makeTestContext());
  const handler = server.server['_requestHandlers'].get('resources/read');
  expect(handler).toBeDefined();
  const response = await handler!({
    method: 'resources/read',
    params: { uri: 'read_file?path=package.json' },
  } as any, {} as any);
  expect(response.contents[0].text).toContain('"name"'); // package.json content
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run core/tool-layer/mcp/resources.test.ts -t 'Invalid URL'`
Expected: throws `Invalid URL` from SDK URL parsing.

- [ ] **Step 3: Register raw resources/read handler in `buildFactoryMcpServer`**

Edit `core/tool-layer/mcp/server.ts`. Add imports:

```ts
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
```

Replace the current `server.resource('workspace-files', ...)` block with:

```ts
const template = buildWorkspaceResourceTemplate(ctx);

server.server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const list = await template.listCallback?.({} as any);
  return list ?? { resources: [] };
});

server.server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  return readWorkspaceResource(ctx, uri);
});
```

Remove the now-unused `description` metadata (or replicate it in a `server.server.setRequestHandler(ListResourcesRequestSchema, ...)` response if needed).

- [ ] **Step 4: Verify ResourceTemplate `list` callback shape still works**

The `ResourceTemplate` constructor accepts a `list` option. Confirm by reading `core/tool-layer/mcp/tools/resources.ts:82-89`. If `listCallback` access path differs in SDK 1.29, replace with a direct call to `collectWorkspaceResources(ctx)` (already exported via the template builder’s closure — extract to a top-level `export function listWorkspaceResources(ctx)` for clean reuse).

If extraction is required:

```ts
// resources.ts
export function listWorkspaceResources(ctx: FactoryContext): { resources: WorkspaceResource[] } {
  return { resources: collectWorkspaceResources(ctx) };
}
```

Then `server.ts`:

```ts
server.server.setRequestHandler(ListResourcesRequestSchema, () =>
  Promise.resolve(listWorkspaceResources(ctx)),
);
```

- [ ] **Step 5: Run all MCP tests**

Run: `pnpm vitest run core/tool-layer/mcp`
Expected: all green; new "Invalid URL" test passes.

- [ ] **Step 6: Run the targeted server-boot test**

Run: `pnpm vitest run core/tool-layer/mcp/server.test.ts` (or the closest equivalent — locate via `ls core/tool-layer/mcp/*.test.ts`).
Expected: green. If a snapshot of `ListResources` shape exists, update it.

- [ ] **Step 7: Commit**

```bash
git add core/tool-layer/mcp/server.ts core/tool-layer/mcp/tools/resources.ts core/tool-layer/mcp/resources.test.ts
git commit -m "fix(mcp): bypass SDK URL parsing for resources/read

Switch resources/list and resources/read to low-level setRequestHandler
so codex's bare and tool-shaped URIs reach our converter instead of
failing in the SDK URL constructor."
```

---

### Task 3: Demote `resources/read failed` from blocked-runtime-surface to advisory

**Files:**
- Modify: `core/agent-runtime/codex-cli.ts`
- Modify: `core/agent-runtime/codex-cli-runtime.test.ts`

Tasks 1+2 make `resources/read` work for codex's URIs. The remaining hostile behavior is `BLOCKED_RUNTIME_SURFACE_PATTERNS` killing any run that ever emits the substring `resources/read failed` on stderr — including transient pre-handshake or path-policy denials. Demote to advisory.

- [ ] **Step 1: Update the existing fatal-block test to assert advisory event**

Edit `core/agent-runtime/codex-cli-runtime.test.ts:480-495`. Replace the assertion that `block_reason: 'blocked-runtime-surface: resources/read failed'` was recorded with:

```ts
it('records resources/read failed as a non-fatal advisory event', () => {
  // … existing setup that emits stderr line 'resources/read failed: file://memory\n' …
  const advisory = events.find(
    (e) => e.kind === 'agent.runtime-advisory' && (e.payload as any).surface === 'resources/read failed',
  );
  expect(advisory).toBeDefined();
  expect((advisory?.payload as any).blocked).toBeUndefined();
  // No agent.run-blocked event for this surface.
  expect(events.some((e) => e.kind === 'agent.run-blocked')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run core/agent-runtime/codex-cli-runtime.test.ts -t 'resources/read'`
Expected: fails on the missing `agent.runtime-advisory` event.

- [ ] **Step 3: Remove the entry from BLOCKED_RUNTIME_SURFACE_PATTERNS and emit advisory instead**

Edit `core/agent-runtime/codex-cli.ts`. Delete the line:

```ts
{ surface: 'resources/read failed', toolName: 'resources/read', re: /resources\/read\s+failed/i },
```

In the stderr-scan path (locate via `grep -n "BLOCKED_RUNTIME_SURFACE_PATTERNS\|detectBlockedRuntimeSurface" core/agent-runtime/codex-cli.ts`), add a parallel advisory scan:

```ts
const ADVISORY_RUNTIME_SURFACE_PATTERNS: Array<{ surface: string; re: RegExp }> = [
  { surface: 'resources/read failed', re: /resources\/read\s+failed/i },
];

function detectAdvisoryRuntimeSurface(stderr: string): { surface: string } | null {
  for (const pattern of ADVISORY_RUNTIME_SURFACE_PATTERNS) {
    if (pattern.re.test(stderr)) return { surface: pattern.surface };
  }
  return null;
}
```

In the place where blocked surfaces emit `agent.run-blocked`, add immediately after:

```ts
const advisory = detectAdvisoryRuntimeSurface(stderrBuffer);
if (advisory != null) {
  eventStore.appendEvent({
    projectId,
    workItemId,
    runId,
    personaId: personaId ?? null,
    kind: 'agent.runtime-advisory',
    payload: { surface: advisory.surface, source: 'codex-cli-stderr' },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run core/agent-runtime/codex-cli-runtime.test.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add core/agent-runtime/codex-cli.ts core/agent-runtime/codex-cli-runtime.test.ts
git commit -m "feat(runtime): demote resources/read failed to advisory event

With Task 1/2 in place, codex's resources/read fallback succeeds for
read_file?path=… and file_exists?path=…. Transient stderr lines that
still contain 'resources/read failed' should no longer abort the run;
emit agent.runtime-advisory instead and let the agent retry naturally."
```

---

### Task 4: Add `collectScopeManifest` helper

**Files:**
- Create: `skills/spec-author/manifest.ts`
- Create: `skills/spec-author/manifest.test.ts`

- [ ] **Step 1: Write failing test**

Create `skills/spec-author/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectScopeManifest } from './manifest.js';

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'manifest-'));
  mkdirSync(join(root, 'apps/web/src/components/detail'), { recursive: true });
  writeFileSync(join(root, 'apps/web/src/components/detail/TaskHeader.tsx'), '');
  writeFileSync(join(root, 'apps/web/src/components/detail/api.ts.bak'), '');
  return root;
}

describe('collectScopeManifest', () => {
  it('returns file + dir entries under each scopeRoot, capped at 800', () => {
    const root = scratchRepo();
    const out = collectScopeManifest(root, ['apps/web/src/components/detail']);
    expect(out.find((e) => e.path === 'apps/web/src/components/detail/TaskHeader.tsx' && e.kind === 'file')).toBeDefined();
    expect(out.find((e) => e.path === 'apps/web/src/components/detail' && e.kind === 'dir')).toBeDefined();
    expect(out.length).toBeLessThanOrEqual(800);
  });

  it('returns [] for non-existent scopeRoots without throwing', () => {
    const root = scratchRepo();
    expect(collectScopeManifest(root, ['does/not/exist'])).toEqual([]);
  });

  it('skips node_modules, .git, dist, .factory', () => {
    const root = scratchRepo();
    mkdirSync(join(root, 'apps/web/src/components/detail/node_modules/foo'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/components/detail/node_modules/foo/index.ts'), '');
    const out = collectScopeManifest(root, ['apps/web/src/components/detail']);
    expect(out.every((e) => !e.path.includes('node_modules'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run skills/spec-author/manifest.test.ts`
Expected: fails — module not found.

- [ ] **Step 3: Implement `collectScopeManifest`**

Create `skills/spec-author/manifest.ts`:

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.factory', 'dist', 'build', '.pnpm']);
const MANIFEST_CAP = 800;

export interface ManifestEntry {
  path: string; // repo-root relative POSIX
  kind: 'file' | 'dir';
}

export function collectScopeManifest(
  repoRoot: string,
  scopeRoots: ReadonlyArray<string>,
): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const scope of scopeRoots) {
    if (out.length >= MANIFEST_CAP) break;
    const abs = join(repoRoot, scope);
    if (!existsSync(abs)) continue;
    walk(abs, scope, out);
  }
  return out.slice(0, MANIFEST_CAP);
}

function walk(absDir: string, relDir: string, out: ManifestEntry[]): void {
  if (out.length >= MANIFEST_CAP) return;
  out.push({ path: relDir, kind: 'dir' });
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MANIFEST_CAP) return;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const rel = posix.join(relDir, entry.name);
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile()) {
      out.push({ path: rel, kind: 'file' });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run skills/spec-author/manifest.test.ts`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add skills/spec-author/manifest.ts skills/spec-author/manifest.test.ts
git commit -m "feat(spec-author): add collectScopeManifest helper

Walks a list of scopeRoots and returns capped file + dir entries to
ground spec-author against the actual worktree shape."
```

---

### Task 5: Wire scope manifest into spec-author context

**Files:**
- Modify: `skills/spec-author/skill.config.ts`
- Modify: `skills/spec-author/prompt.md`
- Modify: `slices/spec-author/workflow.ts` (the canonical invoker — touches `spec-author` at lines 107, 128, 150, 297, 392, 495)

- [ ] **Step 1: Add `existingFileManifest` to context schema + allowlist**

Edit `skills/spec-author/skill.config.ts`. Inside `SpecAuthorContextSchema`:

```ts
existingFileManifest: z
  .array(z.object({ path: z.string(), kind: z.enum(['file', 'dir']) }))
  .optional()
  .describe('Capped list of files+dirs under the spec scopeRoots. Use to ground WP filesOwned.'),
```

Append to `contextAllowlist`: `'existingFileManifest'`.

- [ ] **Step 2: Document manifest contract in spec-author prompt**

Edit `skills/spec-author/prompt.md`. Add to the Input section (after the `<repairFeedback>` bullet):

```markdown
- `<existingFileManifest>` (optional) — JSON array `[{path, kind: 'file' | 'dir'}]` listing files and directories that already exist under the spec scopeRoots. Every WP `filesOwned[].path` that points to a non-test, non-`*.config.ts` production file under `apps/`, `core/`, `slices/`, or `skills/` MUST either appear in this manifest OR be annotated as `{ "path": "…", "status": "new" }`. The validator hard-rejects unannotated missing paths.
```

Update the `### Hard rules` section with a new subsection:

```markdown
#### Grounded `filesOwned`

Each WP `filesOwned` entry is one of:

- A bare string path: `"apps/web/src/components/detail/TaskHeader.tsx"` — must exist in `<existingFileManifest>`.
- An object `{ "path": "apps/web/src/components/detail/NewSection.tsx", "status": "new" }` — declares a file to be created. Validator skips the existence check.

Do not invent paths. If `<existingFileManifest>` is absent, fall back to the manual investigation path and read the directory with `list_dir` before authoring `filesOwned`.
```

- [ ] **Step 3: Inject manifest in `slices/spec-author/workflow.ts`**

Locate the context-building site in `slices/spec-author/workflow.ts`. The skill is invoked from multiple call sites (lines 107, 128, 150, 297, 495); centralise the manifest derivation in a helper near the top of the file and re-use it at each call site. Add:

```ts
import { collectScopeManifest } from '@goose-hub/skills/spec-author/manifest.js';

function dirOf(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash === -1 ? '' : p.slice(0, slash);
}

function deriveSpecScopeRoots(input: {
  prdContext?: { verticalSlices?: Array<{ path?: string }> };
  investigationSynthesis?: { keyFiles?: Array<{ path: string }> };
}): string[] {
  const roots = new Set<string>();
  for (const f of input.investigationSynthesis?.keyFiles ?? []) {
    const d = dirOf(f.path);
    if (d.length > 0) roots.add(d);
  }
  for (const s of input.prdContext?.verticalSlices ?? []) {
    if (typeof s.path === 'string' && s.path.length > 0) roots.add(s.path);
  }
  return Array.from(roots);
}
```

At every call site that builds the spec-author skill context, add:

```ts
const scopeRoots = deriveSpecScopeRoots({ prdContext, investigationSynthesis });
const existingFileManifest = collectScopeManifest(worktreePath, scopeRoots);

// inside the context object passed to runWithEscalation / runtime.run:
context: {
  ...,
  existingFileManifest,
},
contextAllowlist: [
  ...,
  'existingFileManifest',
],
```

(If `worktreePath` is not in scope at that point, thread it through from the workflow’s outer `runFn` parameters — it’s already required to spawn the agent.)

- [ ] **Step 4: Run spec-author workflow tests**

Run: `pnpm vitest run slices/spec-author`
Expected: green. If a test snapshots the context object, add `existingFileManifest: []` to the expected payload.

- [ ] **Step 5: Commit**

```bash
git add skills/spec-author/skill.config.ts skills/spec-author/prompt.md slices/spec-author/workflow.ts
git commit -m "feat(spec-author): inject existingFileManifest into context

slices/spec-author/workflow.ts collects file+dir entries under
scopeRoots inferred from investigation synthesis and PRD vertical
slices; spec-author must ground WP filesOwned against the manifest or
annotate paths as status:new."
```

---

### Task 6: Promote `self-check-grounded-in-code` to per-file rule

**Files:**
- Modify: `skills/spec-author/schema.ts`
- Modify: `skills/spec-author/validate.ts`
- Modify: `skills/spec-author/validate.test.ts` (or whatever the existing validator test file is — locate via `ls skills/spec-author/*.test.ts`)

- [ ] **Step 1: Add failing test cases**

Append to `skills/spec-author/validate.test.ts`:

```ts
describe('self-check-grounded-in-code (per-file)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'spec-author-validate-'));
  mkdirSync(join(tmp, 'apps/web/src/components/detail'), { recursive: true });
  writeFileSync(join(tmp, 'apps/web/src/components/detail/TaskHeader.tsx'), '');

  it('errors when a WP filesOwned entry is a missing production .tsx without status:new', () => {
    const result = validateEngineeringSpec(
      {
        ...baseSpec, // helper that returns a valid minimal spec
        workPackages: [
          {
            id: 'WP1',
            filesOwned: [
              'apps/web/src/components/detail/TaskHeader.tsx', // exists
              'apps/web/src/components/detail/OverviewSection.tsx', // missing
            ],
          },
        ],
      },
      { repoRoot: tmp },
    );
    expect(result.ok).toBe(false);
    expect((result as any).errors.some((e: any) =>
      e.rule === 'self-check-grounded-in-code' &&
      e.message.includes('OverviewSection.tsx'),
    )).toBe(true);
  });

  it('accepts missing files when annotated as status:new', () => {
    const result = validateEngineeringSpec(
      {
        ...baseSpec,
        workPackages: [
          {
            id: 'WP1',
            filesOwned: [
              { path: 'apps/web/src/components/detail/OverviewSection.tsx', status: 'new' },
            ],
          },
        ],
      },
      { repoRoot: tmp },
    );
    expect(result.ok).toBe(true);
  });

  it('skips existence check for *.test.ts, *.spec.ts, *.config.ts, *.d.ts (still allowed to plan new)', () => {
    const result = validateEngineeringSpec(
      {
        ...baseSpec,
        workPackages: [
          {
            id: 'WP1',
            filesOwned: [
              'apps/web/src/components/detail/TaskHeader.test.tsx', // missing test file — ok
              'apps/web/src/components/detail/TaskHeader.tsx',      // existing prod file
            ],
          },
        ],
      },
      { repoRoot: tmp },
    );
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run skills/spec-author/validate.test.ts -t 'grounded-in-code'`
Expected: tests fail — current implementation only fires when ALL WP files are missing.

- [ ] **Step 3: Extend `FileOwnedSchema` to accept either string or `{path, status}`**

Edit `skills/spec-author/schema.ts`. Replace `filesOwned: z.array(z.string())` with:

```ts
const FileOwnedEntrySchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    status: z.enum(['existing', 'new']).optional(),
  }),
]);

// in WorkPackageSchema:
filesOwned: z.array(FileOwnedEntrySchema),
```

Add a helper in the same file:

```ts
export function fileOwnedPath(entry: z.infer<typeof FileOwnedEntrySchema>): string {
  return typeof entry === 'string' ? entry : entry.path;
}
export function fileOwnedStatus(entry: z.infer<typeof FileOwnedEntrySchema>): 'existing' | 'new' {
  if (typeof entry === 'string') return 'existing';
  return entry.status ?? 'existing';
}
```

Update existing uses of `filesOwned.some((p) => p.startsWith(...))` etc. in `validate.ts` and elsewhere to call `fileOwnedPath(entry)` first. Locate with `grep -rn "filesOwned" skills/spec-author core slices | head -30`.

- [ ] **Step 4: Replace the grounded-in-code check with per-file logic**

Edit `skills/spec-author/validate.ts:373-394`. Replace the entire block with:

```ts
const GROUNDABLE_SCOPE_RE = /^(apps|core|slices|skills)\//;
const EXEMPT_SUFFIX_FOR_GROUNDING =
  /\.(test|spec)\.(ts|tsx)$|\.(config|d)\.ts$/;

if (options.repoRoot != null) {
  const repoRoot = options.repoRoot;
  for (const wp of spec.workPackages) {
    for (const entry of wp.filesOwned) {
      const path = fileOwnedPath(entry);
      const status = fileOwnedStatus(entry);
      if (status === 'new') continue;
      if (!GROUNDABLE_SCOPE_RE.test(path)) continue;
      if (EXEMPT_SUFFIX_FOR_GROUNDING.test(path)) continue;
      if (sensitivePattern.test(path)) continue;
      if (existsSync(join(repoRoot, path))) continue;
      errors.push({
        rule: 'self-check-grounded-in-code',
        message: `WP '${wp.id}' filesOwned path '${path}' does not exist in worktree and is not annotated status:'new'. Either fix the path or declare it as a new file.`,
        ref: wp.id,
      });
    }
  }
}
```

- [ ] **Step 5: Run all spec-author tests**

Run: `pnpm vitest run skills/spec-author`
Expected: green.

- [ ] **Step 6: Run docs-audit to confirm prompt + schema stay in sync**

Run: `pnpm audit-docs`
Expected: green. If a drift report appears for spec-author, fix the cited surface.

- [ ] **Step 7: Commit**

```bash
git add skills/spec-author/schema.ts skills/spec-author/validate.ts skills/spec-author/validate.test.ts
git commit -m "feat(spec-author): per-file grounded-in-code check + status:new opt-in

Replaces the all-files-missing heuristic. Production files under
apps/, core/, slices/, skills/ must exist in the worktree OR be
annotated { status: 'new' }. Test, config, and .d.ts files are exempt."
```

---

### Task 7: Forward `priorEvidenceSpecPath` through fix-feedback

**Files:**
- Modify: `slices/fix-feedback/workflow.ts`
- Modify: `skills/implement/skill.config.ts`
- Modify: `skills/implement/prompt.md`
- Modify: `slices/fix-feedback/slice.test.ts`

- [ ] **Step 1: Write failing fix-feedback test**

Append to `slices/fix-feedback/slice.test.ts`:

```ts
it('forwards priorEvidenceSpecPath from the most recent implement-complete event', async () => {
  const workItem = makeWorkItem();
  // Seed events: pr.opened + agent.implement-complete with evidenceSpecPath
  eventStore.appendEvent({
    projectId: 'proj',
    workItemId: workItem.id,
    kind: 'pr.opened',
    payload: { prNumber: 7, branch: 'factory/x', baseBranch: 'main', worktreePath: '/tmp/wt', devRunId: 'dev-1' },
    runId: 'dev-1',
  });
  eventStore.appendEvent({
    projectId: 'proj',
    workItemId: workItem.id,
    kind: 'agent.implement-complete',
    payload: { runId: 'dev-1', evidenceSpecPath: 'apps/web/e2e/issue-123.spec.ts' },
    runId: 'dev-1',
  });
  // Run fix-feedback with a stub runtime that captures context
  const capturedContexts: any[] = [];
  await runFixFeedbackWorkflow(workItem, stubStateSource, 'proj', 'goose-hub', {
    runtime: stubRuntimeCapturing(capturedContexts),
  });
  expect(capturedContexts[0]?.priorEvidenceSpecPath).toBe('apps/web/e2e/issue-123.spec.ts');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run slices/fix-feedback/slice.test.ts -t 'priorEvidenceSpecPath'`
Expected: fails — context object does not include the field.

- [ ] **Step 3: Add `priorEvidenceSpecPath` to implement skill context**

Edit `skills/implement/skill.config.ts`. Inside the implement context schema (locate with `grep -n 'ImplementContextSchema\|contextSchema' skills/implement/skill.config.ts`):

```ts
priorEvidenceSpecPath: z
  .string()
  .nullable()
  .optional()
  .describe('Path to the evidence spec authored or reused by the prior dev/fix-feedback cycle on this work item.'),
```

Append `'priorEvidenceSpecPath'` to the `contextAllowlist` of the implement skill.

- [ ] **Step 4: Document in implement prompt**

Edit `skills/implement/prompt.md`. Add a single bullet under the `evidence` section:

```markdown
- If `priorEvidenceSpecPath` is provided and your changes still touch `apps/web/`, reuse it as `evidenceSpecPath` unless the prior spec is now stale for the changed surface. If you cannot reuse it and cannot author a new one, return `evidenceSpecPath: null` with a `SKIP_GATE` decision summary explaining why (e.g., "evidence skipped: type-only handler export, no UI surface changed").
```

- [ ] **Step 5: Collect + forward prior `evidenceSpecPath` in fix-feedback**

Edit `slices/fix-feedback/workflow.ts`. Above `runFixFeedbackWorkflow`, add:

```ts
function findPriorEvidenceSpecPath(
  events: ReturnType<typeof eventStore.replay>,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind !== 'agent.implement-complete' && e.kind !== 'agent.fix-feedback-complete') continue;
    const payload = e.payload as { evidenceSpecPath?: unknown };
    if (typeof payload.evidenceSpecPath === 'string' && payload.evidenceSpecPath.length > 0) {
      return payload.evidenceSpecPath;
    }
  }
  return null;
}
```

Inside `runFixFeedbackWorkflow`, compute it once near the other event scans:

```ts
const priorEvidenceSpecPath = findPriorEvidenceSpecPath(events);
```

Add to the implement spec’s context object:

```ts
context: {
  ...,
  priorEvidenceSpecPath,
},
contextAllowlist: [
  ...,
  'priorEvidenceSpecPath',
],
```

Also extend the `fix-feedback-complete` event payload to include `evidenceSpecPath: implementOutput.evidenceSpecPath` (it’s currently dropped — locate the `kind: 'agent.fix-feedback-complete'` `appendEvent` near `slices/fix-feedback/workflow.ts:516-533`).

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run slices/fix-feedback skills/implement`
Expected: green.

- [ ] **Step 7: Run docs-audit**

Run: `pnpm audit-docs`
Expected: green; if not, fix the cited drift.

- [ ] **Step 8: Commit**

```bash
git add slices/fix-feedback/workflow.ts skills/implement/skill.config.ts skills/implement/prompt.md slices/fix-feedback/slice.test.ts
git commit -m "feat(fix-feedback): forward priorEvidenceSpecPath into implement context

fix-feedback now reads evidenceSpecPath from the most recent
implement-complete or fix-feedback-complete event and passes it to the
repair run so apps/web edits can reuse the prior cycle's spec instead
of returning null and tripping the contract gate."
```

---

## Verification across all three fixes

After Task 7 is committed, run the full repo verification gate:

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm audit-docs`
- [ ] `pnpm manifest` (regenerate inventory if any slice/skill files changed)

All four must pass before opening PRs.

## Eval — post-deploy signals

| Metric | Pre (observed on 1021–1023) | Target |
|---|---|---|
| `agent.tool-call` `tool_name:"resources/read"` `status:"failed"` with `Invalid URL` | 3+ per fix-feedback run | 0 |
| `agent.run-blocked` `block_reason:"blocked-runtime-surface: resources/read failed"` | every fix-feedback run for codex agents | 0 |
| `agent.runtime-advisory` `surface:"resources/read failed"` | 0 (didn’t exist) | non-zero, advisory only |
| spec-author runs with `self-check-grounded-in-code` failures | 5+ per failed spec | 0 unless agent genuinely typo’d; survivors caught at retry with explicit error |
| `agent.run-failed` `error: "contract gate blocked: evidenceSpecPath is required for apps/web changes"` on fix-feedback | observed on #1022 | 0 when prior dev cycle authored a spec |

## PR strategy

Open three PRs in order:

1. **PR A — G1**: Tasks 1+2+3. Title `M20.10: fix codex resources/read converter + demote blocking pattern`. Closes the meta-issue tracking #1022/#1023 cascade.
2. **PR B — G2**: Tasks 4+5+6. Title `M20.11: ground spec-author with existing-file manifest + per-file check`.
3. **PR C — G3**: Task 7. Title `M20.12: forward priorEvidenceSpecPath through fix-feedback`. Depends on A landing first so the eval signal is clean.

Each PR includes a `## Eval` section in the body pointing at the rows of the table above it owns.
