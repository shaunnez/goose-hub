#!/usr/bin/env node
/**
 * File the M1 starter issues into a GitHub repo.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node file-m1-issues.mjs shaunnez/goose-hub
 *
 * Idempotent: if an issue with the same title already exists (open or closed),
 *             the script skips it. Re-runs are safe.
 *
 * Prerequisites:
 *   1. Repo exists.
 *   2. Labels installed (run install-labels.mjs first).
 *   3. Milestone "M1: Bootstrap Source of Truth" exists and is open.
 *
 * After filing:
 *   - Each issue is wired to the M1 milestone.
 *   - Labels: type:*, priority:*, schedule:current, exec:*.
 *   - Body-level dependencies render as `Depends on #N` after a second pass
 *     (we file all issues first, then patch bodies with real issue numbers).
 */

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.argv[2];

if (!TOKEN) {
  console.error('Set GITHUB_TOKEN env var.');
  process.exit(1);
}
if (!REPO || !REPO.includes('/')) {
  console.error('Usage: GITHUB_TOKEN=xxx node file-m1-issues.mjs <owner>/<repo>');
  process.exit(1);
}

const M1_TITLE = 'M1: Bootstrap Source of Truth';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'goose-hub-bootstrap-script',
};

// Each issue references dependencies by *slug* (its position in this array).
// After we know the actual issue numbers, we patch bodies with the real refs.
const ISSUES = [
  {
    slug: 'state-enum',
    title: 'M1.01 — Define typed state enum in core/state-machine/states.ts',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Create the canonical typed enum of all factory:* states. Source of truth for every state name used in code and labels.

## Scope

- Create \`core/state-machine/states.ts\`
- Export a typed enum (or const-as-tuple) listing all 23 canonical states from PLAN section 9.5
- Export type aliases used elsewhere (\`State\`, \`StateName\`)
- Export a frozen array of all states for iteration

## Acceptance criteria

- [ ] All 23 states from PLAN section 9.5 are present
- [ ] Importing any non-canonical state name fails TypeScript
- [ ] Unit test exists asserting count and exact membership
- [ ] No runtime side effects on import

## References

- PLAN section 9.5 (full canonical state list)
- PLAN section 4 (domain model: State definition)

## Out of scope

- Transition rules → see M1.02
- Conflict resolution → see M1.03
- Lane mapping → that lives in \`ui/kanban/lanes.config.ts\`, not here
`,
  },
  {
    slug: 'transition-table',
    title: 'M1.02 — Define legal transition table in core/state-machine/transitions.ts',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: ['state-enum'],
    body: `## Goal

Encode which state-to-state transitions are legal. Used by every workflow and by the UI when surfacing manual transitions.

## Scope

- Create \`core/state-machine/transitions.ts\`
- Define legal transitions per the state machine in PLAN section 9
- Export \`isLegalTransition(from: State, to: State): boolean\`
- Export \`legalTargets(from: State): State[]\`
- Cover all paths from PLAN section 9.1 and 9.2 (issue and PR-state lifecycles)

## Acceptance criteria

- [ ] Every transition shown in PLAN section 9.1 is allowed
- [ ] Every transition shown in PLAN section 9.2 is allowed
- [ ] All other transitions return false from \`isLegalTransition\`
- [ ] Unit tests cover: happy path (triaging → accepted → ... → archived), illegal jumps (triaging → done), terminal states (archived has no exits)
- [ ] Test for re-entry: \`needs-fix → in-progress → needs-qa\` works

## References

- PLAN section 9 (state machine)
- PLAN section 11.1 (workflows that drive transitions)

## Out of scope

- Conflict resolution → see M1.03
- Workflow dispatch → much later milestones
`,
  },
  {
    slug: 'conflict-resolver',
    title: 'M1.03 — Implement label conflict resolver with unit tests',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: ['state-enum'],
    body: `## Goal

Resolve real-world label inconsistencies deterministically. GitHub labels can be edited manually, partial transitions can leave conflicts; the orchestrator must always derive a single canonical state.

## Scope

- Create \`core/state-machine/conflict-resolver.ts\`
- Export \`resolveState(labels: string[]): { state: State, conflicts: ConflictReason[] }\`
- Implement all 7 rules from PLAN section 9.3:
  1. Zero factory:* labels on an open issue → treat as factory:triaging
  2. Two or more factory:* state labels → pick most-advanced in canonical order, log others
  3. Unknown factory:* label → ignore, log warning
  4. factory:archived + any active state → archived wins
  5. Manual edit during active workflow → re-read and adapt (this is a runtime concern; the resolver just reports)
  6. Legal transition → no conflict
  7. Illegal transition (caller will compare prev vs current) → flagged

## Acceptance criteria

- [ ] All 7 conflict cases have explicit unit tests (PLAN section 9.3 mandates this)
- [ ] Conflict reasons are typed and machine-readable (not free strings)
- [ ] Resolver is pure: no side effects, deterministic output for same input
- [ ] Documented in \`core/state-machine/README.md\`

## References

- PLAN section 9.3 (conflict resolution rules)
- PLAN rule 14 (orchestrator stateless; relies on this resolver)

## Out of scope

- Emitting state.conflict-resolved events → that happens at the orchestrator/source-source layer, not here
- Auto-correcting labels in GitHub → that's a write operation, deferred to M2 or later
`,
  },
  {
    slug: 'sqlite-schema',
    title: 'M1.04 — SQLite schema and Drizzle migrations: project_state, events, governance_audit',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Stand up the local DB. M1 only needs three tables — others come in later milestones as features land.

## Scope

- Initialise Drizzle ORM in the repo
- Create migrations for:
  - \`project_state\` — project_id (PK), active_milestone_number, active_milestone_set_at, active_milestone_set_by, last_tick_at
  - \`events\` — append-only event store with id, project_id, work_item_id (nullable), kind, payload (JSON), created_at; index on (project_id, created_at)
  - \`governance_audit\` — every PR check (pass/fail with reasons): id, pr_url, project_id, ok, violations (JSON), checked_at
- DB lives at \`~/.factory/data/factory.db\` (creates dirs if missing)
- Provide a \`db.ts\` that exports a connected Drizzle instance
- Migrations runnable via \`pnpm db:migrate\`

## Acceptance criteria

- [ ] \`pnpm db:migrate\` creates the DB file and tables idempotently
- [ ] Drizzle schema types compile
- [ ] Inserting a row into each table from a smoke test works
- [ ] Re-running migrations is safe (no errors, no duplicate tables)

## References

- PLAN section 24 (local database design)
- PLAN principle 6 (operational state lives here)

## Out of scope

- Other tables (personas, inbox_notes, budgets, etc.) → added in the milestones that need them
- Backup tooling → deferred (manual responsibility for v0)
- Migration to Postgres → noted in PLAN, not now
`,
  },
  {
    slug: 'state-source-interface',
    title: 'M1.05 — StateSource interface',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Define the abstraction every source-of-truth implementation conforms to. M1 ships GitHub; later milestones add Jira and Linear by writing new files against this interface.

## Scope

- Create \`core/state-source/interface.ts\`
- Export interfaces from PLAN section 7.1: \`StateSource\`, \`WorkItem\`, \`Milestone\`, supporting types
- No implementations in this issue — those land in M1.06

## Acceptance criteria

- [ ] All methods from PLAN section 7.1 present
- [ ] WorkItem has all fields from PLAN section 7.1, including \`dependsOn\`/\`blocks\` arrays and \`milestoneId\`
- [ ] No implementation logic; pure types and contracts
- [ ] Type-checks against an empty stub implementation

## References

- PLAN section 7.1 (StateSource interface specification)
- PLAN principle 14 (pluggability through interfaces)

## Out of scope

- GitHub implementation → M1.06
- Jira/Linear stubs → much later
`,
  },
  {
    slug: 'github-labels-source',
    title: 'M1.06 — GitHubLabelsSource implementation',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: ['state-source-interface'],
    body: `## Goal

Implement \`StateSource\` for a single GitHub repo using Issues + labels.

## Scope

- Create \`core/state-source/github-labels.ts\`
- Implement all methods from \`StateSource\` interface (M1.05)
- Use GitHub REST API (no GraphQL for v0)
- Auth via GITHUB_TOKEN env var
- Parse factory:* labels into State, type:* / priority:* / mode:* / schedule:* / exec:* into the corresponding WorkItem fields
- Parse \`Depends on\` and \`Blocks\` from issue bodies (tolerant parser per PLAN section 12.4)
- M1 only needs read methods to be solid: \`listOpenWork\`, \`getItem\`, \`listMilestones\`, \`getActiveMilestone\`. Write methods can be implemented but are not exercised by \`goose status\` (they're tested in M2).
- \`watchForUpdates\` not required for M1; can throw "not implemented" until M3

## Acceptance criteria

- [ ] \`listOpenWork()\` returns parsed WorkItems for shaunnez/goose-hub
- [ ] WorkItems have correct state, type, priority, mode, schedule, exec, dependsOn, blocks parsed from labels and body
- [ ] Pagination works (>30 issues handled correctly)
- [ ] Rate-limit handling: returns clear error when limit hit
- [ ] Unit tests with mocked fetch
- [ ] Smoke test against the real repo runs successfully

## References

- PLAN section 7.1, 12.4 (interface and dependency parsing)
- PLAN section 9 (state labels)

## Out of scope

- Jira / Linear adapters → much later
- Webhook handling → M2 or M3
- Write operations driven by orchestrator → M2 onwards
`,
  },
  {
    slug: 'install-labels-script',
    title: 'M1.07 — scripts/install-labels.ts: install factory:* labels on a repo',
    labels: ['type:feature', 'priority:medium', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Port the bootstrap shell script into a proper TypeScript file under the project structure. This replaces the M0 manual install script.

## Scope

- Create \`scripts/install-labels.ts\`
- Same canonical label set as the M0 install-labels.mjs
- Idempotent: existing labels are updated; never deletes
- Runnable as \`pnpm install-labels <owner>/<repo>\`
- Reads GITHUB_TOKEN from env

## Acceptance criteria

- [ ] Running against shaunnez/goose-hub leaves labels in correct state (no diff)
- [ ] Running against an empty test repo creates all labels
- [ ] Updating a label's color/description in the script and re-running updates it on GitHub
- [ ] Failures (auth, rate-limit, network) report clearly and exit non-zero

## References

- M0 install-labels.mjs (port from this)
- Full label set in PLAN sections 9.4, 9.5

## Out of scope

- Removing labels → never auto-remove
- Migrating renamed labels → manual concern
`,
  },
  {
    slug: 'project-config-self',
    title: 'M1.08 — target-projects/goose-hub-self config files (project.config.ts, MISSION.md, FACTORY_RULES.md)',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

The first registered target project: Goose Hub itself. Establishes the config shape and per-project governance pattern that future projects follow.

## Scope

- Create \`target-projects/goose-hub-self/project.config.ts\` matching the example in PLAN section 8
- Create \`target-projects/goose-hub-self/MISSION.md\` (project-specific extension of root MISSION)
- Create \`target-projects/goose-hub-self/FACTORY_RULES.md\` (project-specific extension of root rules)
- Create \`target-projects/goose-hub-self/personas/\` directory with a placeholder README (no actual personas until M5+)
- Stack section in project.config.ts populated by hand (Node + pnpm + TypeScript + Drizzle + SQLite + React + Vite + shadcn/ui + Biome + Vitest + Playwright + Zod)

## Acceptance criteria

- [ ] project.config.ts type-checks against ProjectConfig type
- [ ] All required fields present per PLAN section 8
- [ ] mode is 'supervised'
- [ ] isolation.mode is 'native' (autonomous + Docker is M16)
- [ ] Per-role models, fallbacks, advisors per PLAN section 8 example
- [ ] Per-role tool allowlists per PLAN section 8 example
- [ ] Governance immutablePaths includes all paths from PLAN section 26

## References

- PLAN section 8 (full config example)
- PLAN section 26 (governance)

## Out of scope

- Other projects (Diamond, Phaser, etc.) → M12 bootstrap workflow handles those
- Loading and validating configs at runtime → that's M1.09 (CLI uses it)
`,
  },
  {
    slug: 'cli-status',
    title: 'M1.09 — goose status <slug> CLI command',
    labels: ['type:feature', 'priority:high', 'schedule:current', 'exec:serial'],
    dependsOn: ['transition-table', 'conflict-resolver', 'sqlite-schema', 'github-labels-source', 'project-config-self'],
    body: `## Goal

The single user-facing surface of M1. The exit criterion for the entire milestone is this command working end-to-end.

## Scope

- Create \`apps/cli/\` package
- Implement \`goose status <project-slug>\` that:
  1. Loads the project config from \`target-projects/<slug>/project.config.ts\`
  2. Constructs a \`GitHubLabelsSource\` from the config
  3. Fetches active milestone and open work items
  4. Runs the conflict resolver against each item's labels
  5. Validates each item's state against the legal transition table where applicable
  6. Prints to stdout: active milestone, list of work items grouped by state, conflict warnings, transition validity summary
- Output format is human-readable, not JSON (--json flag can come later)
- Exit non-zero if config is missing or GitHub auth fails
- \`pnpm goose status goose-hub-self\` is the canonical invocation

## Acceptance criteria

- [ ] \`pnpm goose status goose-hub-self\` runs against the real repo and prints expected info
- [ ] Active milestone shown correctly
- [ ] Issues grouped by factory:* state
- [ ] At least one synthetic conflict (manually applied two factory:* state labels to a test issue) surfaces a warning
- [ ] Auth failure produces a clear error, not a stack trace
- [ ] Exits non-zero on error

## Exit criterion for M1

This is the issue whose acceptance criteria define M1 done. When this works against real GitHub, M1 ships.

## References

- PLAN section 28 M1 exit criteria
- All preceding M1 issues

## Out of scope

- \`goose tick\` and other commands → later milestones
- JSON output → later
- Streaming watch mode → M3 or later
`,
  },
  {
    slug: 'reference-audit',
    title: 'M1.10 — Reference audit: docs/archive/legacy/reference-audit.md',
    labels: ['type:chore', 'priority:high', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Document what to port from the existing Slack-bot harness, what to leave behind, and what gaps in the plan the audit reveals. Gates any porting in later milestones.

## Scope

- Create \`docs/archive/legacy/reference-audit.md\`
- Walk through the existing harness codebase and document:
  - **Reusable concepts** — repo matching strategy, Bitbucket MCP, Jira function shapes, MCP tool definitions, auth/token handling, prompt patterns that worked, failure modes already discovered, useful UI flows
  - **Code worth porting** — specific files/modules clean enough to bring across
  - **Code to avoid** — tightly coupled orchestration logic, hidden inline prompts, untyped contracts, anything that assumes one project / one repo / one workflow
  - **Gaps in PLAN** — anything the audit reveals that the plan doesn't address
- Decision per file: PORT, REWRITE, or SKIP
- Audit must be reviewed and signed off by human (a comment on the PR confirms)

## Acceptance criteria

- [ ] Document committed at \`docs/archive/legacy/reference-audit.md\`
- [ ] Every major area of the existing harness covered (repo matcher, Bitbucket layer, Jira layer, agent orchestration, UI, hooks, observability)
- [ ] Each item has explicit PORT/REWRITE/SKIP verdict with reasoning
- [ ] Plan gaps section either lists gaps or explicitly says "none found"
- [ ] Human-reviewed and signed off in PR comment

## References

- PLAN principle 15 (reference code is evidence, not architecture)
- PLAN section 28 M1 scope

## Out of scope

- Actually porting code → those are separate issues in later milestones (e.g. Bitbucket adapter in M14, repo matcher concepts in M5)
`,
  },
  {
    slug: 'github-actions-ci',
    title: 'M1.11 — GitHub Actions CI: lint + typecheck + test',
    labels: ['type:chore', 'priority:medium', 'schedule:current', 'exec:parallel'],
    dependsOn: [],
    body: `## Goal

Every PR runs lint, typecheck, and tests automatically. CI is the second-tier safety net for a system that wants agents writing code.

## Scope

- Create \`.github/workflows/ci.yml\`
- Triggers: pull_request to main, push to main
- Steps:
  1. Checkout
  2. Setup Node (use .nvmrc or hardcoded current LTS)
  3. Setup pnpm
  4. \`pnpm install --frozen-lockfile\`
  5. \`pnpm lint\` (Biome)
  6. \`pnpm typecheck\` (tsc --noEmit)
  7. \`pnpm test\` (Vitest)
- Add \`pnpm test:e2e\` step but mark continue-on-error initially (Playwright comes in M2)
- Cache pnpm store for speed

## Acceptance criteria

- [ ] Workflow runs successfully on a PR
- [ ] Failing lint, typecheck, or test fails the PR check
- [ ] Cache works (second run faster)
- [ ] Total CI time under 3 minutes for an empty-change PR

## References

- PLAN principle 7 (CI YAML is allowed; product YAML is not)
- PLAN rule 28 (same)

## Out of scope

- Deployment workflows → never (local-only product)
- Release automation → much later
- Dependabot config → can come later as a chore
`,
  },
];

const API = `https://api.github.com/repos/${REPO}`;

async function findMilestone() {
  const res = await fetch(`${API}/milestones?state=open&per_page=100`, { headers });
  if (!res.ok) {
    console.error(`Failed to list milestones: ${res.status}`);
    process.exit(1);
  }
  const milestones = await res.json();
  const m = milestones.find(m => m.title === M1_TITLE);
  if (!m) {
    console.error(`Milestone "${M1_TITLE}" not found. Create it on GitHub first.`);
    process.exit(1);
  }
  return m.number;
}

async function listExistingIssues() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API}/issues?state=all&per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`Failed to list issues: ${res.status}`);
      process.exit(1);
    }
    const batch = await res.json();
    // /issues includes PRs; filter them out
    const issuesOnly = batch.filter(i => !i.pull_request);
    all.push(...issuesOnly);
    if (batch.length < 100) break;
    page += 1;
  }
  return all;
}

async function createIssue(issue, milestoneNumber) {
  const res = await fetch(`${API}/issues`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      milestone: milestoneNumber,
    }),
  });
  if (!res.ok) {
    console.error(`  failed to create "${issue.title}": ${res.status} ${await res.text()}`);
    return null;
  }
  return await res.json();
}

async function patchIssueBody(number, body) {
  const res = await fetch(`${API}/issues/${number}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    console.error(`  failed to patch issue #${number}: ${res.status}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(`Filing M1 starter issues into ${REPO}...`);

  const milestoneNumber = await findMilestone();
  console.log(`Found milestone "${M1_TITLE}" as #${milestoneNumber}`);

  const existing = await listExistingIssues();
  const titleToNumber = new Map(existing.map(i => [i.title, i.number]));

  // Pass 1: create issues that don't exist yet, recording slug → number
  const slugToNumber = new Map();
  for (const issue of ISSUES) {
    if (titleToNumber.has(issue.title)) {
      const n = titleToNumber.get(issue.title);
      slugToNumber.set(issue.slug, n);
      console.log(`  = "${issue.title}" already exists as #${n} (skipping create)`);
      continue;
    }
    const created = await createIssue(issue, milestoneNumber);
    if (created) {
      slugToNumber.set(issue.slug, created.number);
      console.log(`  + created "${issue.title}" as #${created.number}`);
    }
  }

  // Pass 2: patch bodies to inject "Depends on #N" references where needed
  for (const issue of ISSUES) {
    if (issue.dependsOn.length === 0) continue;
    const num = slugToNumber.get(issue.slug);
    if (!num) continue;
    const refs = issue.dependsOn
      .map(slug => slugToNumber.get(slug))
      .filter(Boolean)
      .map(n => `#${n}`)
      .join(', ');
    if (!refs) continue;
    const dependsLine = `\n\n---\n\n**Depends on:** ${refs}\n`;
    const newBody = issue.body + dependsLine;
    const ok = await patchIssueBody(num, newBody);
    if (ok) console.log(`  ~ patched #${num} body with "Depends on ${refs}"`);
  }

  console.log(`\nDone. ${slugToNumber.size}/${ISSUES.length} issues present in milestone.`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
