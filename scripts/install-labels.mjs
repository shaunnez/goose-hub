#!/usr/bin/env node
/**
 * Install the full factory:* label set on a GitHub repo.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node install-labels.mjs shaunnez/goose-hub
 *
 * Idempotent: existing labels are updated to match the canonical color/description.
 *             Labels not in this script are left alone (we never delete).
 *
 * This is the manual M0 version. M1 issue #7 will create a proper
 * scripts/install-labels.ts under the new project structure.
 */

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.argv[2];

if (!TOKEN) {
  console.error('Set GITHUB_TOKEN env var (a GitHub personal access token with repo scope).');
  process.exit(1);
}
if (!REPO || !REPO.includes('/')) {
  console.error('Usage: GITHUB_TOKEN=xxx node install-labels.mjs <owner>/<repo>');
  process.exit(1);
}

// Canonical label set. Colors are 6-char hex without #.
// Grouped by category for readability — order does not matter.
const LABELS = [
  // factory:* state machine
  { name: 'factory:triaging',              color: 'fbca04', description: 'Awaiting triage decision' },
  { name: 'factory:accepted',              color: '0e8a16', description: 'Accepted by triage' },
  { name: 'factory:rejected',              color: 'e6e6e6', description: 'Rejected by triage' },
  { name: 'factory:grounding',             color: '14b8a6', description: 'Feature code-grounding preflight' },
  { name: 'factory:grilling',              color: '8b5cf6', description: 'Grill-me chat in progress' },
  { name: 'factory:prd-drafting',          color: '8b5cf6', description: 'PRD being written' },
  { name: 'factory:prd-review',            color: '8b5cf6', description: 'Awaiting human PRD approval' },
  { name: 'factory:decomposing',           color: '8b5cf6', description: 'PRD being decomposed into slices' },
  { name: 'factory:issues-created',        color: '8b5cf6', description: 'Child slices created' },
  { name: 'factory:research-pending',      color: 'ec4899', description: 'Research analysis pending' },
  { name: 'factory:research-complete',     color: 'ec4899', description: 'Research analysis complete' },
  { name: 'factory:investigating',         color: '06b6d4', description: 'Investigation in progress' },
  { name: 'factory:investigation-complete',color: '06b6d4', description: 'Investigation complete' },
  { name: 'factory:dev-ready',             color: '1d76db', description: 'Ready for development' },
  { name: 'factory:in-progress',           color: '1d76db', description: 'PR opened, work in progress' },
  { name: 'factory:needs-qa',              color: 'f97316', description: 'Awaiting QA holdout' },
  { name: 'factory:qa-failed',             color: '1d76db', description: 'QA failed; back to dev' },
  { name: 'factory:needs-review',          color: '22c55e', description: 'QA passed; awaiting Review holdout' },
  { name: 'factory:needs-fix',             color: '1d76db', description: 'Review found issues; back to dev' },
  { name: 'factory:approved',              color: '22c55e', description: 'Approved; awaiting human merge gate' },
  { name: 'factory:retrospecting',         color: '14b8a6', description: 'Retrospective in progress' },
  { name: 'factory:needs-human',           color: 'b91c1c', description: 'Escalated to human; agents stop' },
  { name: 'factory:done',                  color: 'd1d5db', description: 'Done' },
  { name: 'factory:archived',              color: 'd1d5db', description: 'Archived (post-done sweep)' },

  // factory:* control / safety
  { name: 'factory:rate-limited',          color: 'b91c1c', description: 'Held by flood protection' },
  { name: 'factory:budget-exceeded',       color: 'b91c1c', description: 'Held by budget cap' },
  { name: 'factory:tool-violation',        color: 'b91c1c', description: 'Agent attempted forbidden tool' },
  { name: 'factory:gate-pending',          color: 'fbca04', description: 'Awaiting human approval at a gate' },
  { name: 'factory:improvement-candidate', color: '14b8a6', description: 'Retrospective flagged for review' },
  { name: 'factory:advisor-flagged',       color: 'fbca04', description: 'Advisor recommended revision' },
  { name: 'factory:bootstrap-pr',          color: '8b5cf6', description: 'Bootstrap PR; governance creation allowed' },
  { name: 'factory:docs',                  color: '0075ca', description: 'Plan/doc issue' },

  // type:*
  { name: 'type:feature',                  color: '0e8a16', description: 'New capability' },
  { name: 'type:bug',                      color: 'b91c1c', description: 'Defect to fix' },
  { name: 'type:chore',                    color: 'd1d5db', description: 'Maintenance / infra' },
  { name: 'type:research',                 color: 'ec4899', description: 'Research lane' },

  // priority:*
  { name: 'priority:critical',             color: '7f1d1d', description: 'Critical priority' },
  { name: 'priority:high',                 color: 'b91c1c', description: 'High priority' },
  { name: 'priority:medium',               color: 'f97316', description: 'Medium priority' },
  { name: 'priority:low',                  color: 'd1d5db', description: 'Low priority' },

  // mode:*
  { name: 'mode:supervised',               color: '6b7280', description: 'Override: supervised mode for this issue' },
  { name: 'mode:autonomous',               color: '6b7280', description: 'Override: autonomous mode for this issue' },

  // schedule:*
  { name: 'schedule:current',              color: '0075ca', description: 'In active milestone, ready to work' },
  { name: 'schedule:next',                 color: '93c5fd', description: 'Queued for next milestone' },
  { name: 'schedule:later',                color: 'dbeafe', description: 'Parked, no milestone yet' },
  { name: 'schedule:blocked-by',           color: 'fbca04', description: 'Waiting on dependency (see body)' },

  // exec:*
  { name: 'exec:serial',                   color: 'a5b4fc', description: 'Must run serially with siblings' },
  { name: 'exec:parallel',                 color: 'c7d2fe', description: 'May run alongside siblings' },
];

const API = `https://api.github.com/repos/${REPO}/labels`;

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'goose-hub-bootstrap-script',
};

async function getExistingLabels() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API}?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      console.error(`Failed to list labels: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return new Map(all.map(l => [l.name, l]));
}

async function createLabel(label) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!res.ok) {
    console.error(`  failed to create ${label.name}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function updateLabel(oldName, label) {
  const res = await fetch(`${API}/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      new_name: label.name,
      color: label.color,
      description: label.description,
    }),
  });
  if (!res.ok) {
    console.error(`  failed to update ${oldName}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(`Installing ${LABELS.length} labels on ${REPO}...`);
  const existing = await getExistingLabels();

  let created = 0, updated = 0, unchanged = 0, failed = 0;

  for (const label of LABELS) {
    const current = existing.get(label.name);
    if (!current) {
      const ok = await createLabel(label);
      if (ok) { created++; console.log(`  + ${label.name}`); }
      else failed++;
    } else if (current.color !== label.color || (current.description || '') !== label.description) {
      const ok = await updateLabel(label.name, label);
      if (ok) { updated++; console.log(`  ~ ${label.name}`); }
      else failed++;
    } else {
      unchanged++;
    }
  }

  console.log(`\nDone. Created ${created}, updated ${updated}, unchanged ${unchanged}, failed ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
