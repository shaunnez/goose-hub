#!/usr/bin/env tsx
/**
 * Audit governance and high-traffic docs for known drift patterns.
 *
 * Usage:
 *   pnpm audit-docs          # exit 0 if no errors (warns are non-fatal)
 *   pnpm audit-docs --strict # exit non-zero on any warning too
 *
 * What it checks:
 *   1. Skill structure — every skills/<name>/ has prompt.md + schema.ts + skill.config.ts
 *   2. Role list in CLAUDE.md matches the Role union in core/types.ts
 *   3. Canonical file references in CLAUDE.md still exist
 *   4. Milestone span claim in CLAUDE.md vs goose-hub-self/project.config.ts
 *   5. Skills mentioned in README.md still exist (informational)
 *
 * Governance files (CLAUDE.md, FACTORY_RULES.md, MISSION.md) are NEVER modified
 * by this script. It reports drift; the human owner amends.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  severity: Severity;
  area: string;
  message: string;
  file?: string;
}

const REQUIRED_SKILL_FILES = ['schema.ts', 'skill.config.ts'] as const;
// Prompts can be variant-suffixed (prompt.backend.md, prompt.frontend.md, etc.) — accept any prompt*.md.
const PROMPT_RE = /^prompt(\..+)?\.md$/;

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name);
}

export function auditSkillStructure(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  const skillsDir = path.join(repoRoot, 'skills');
  for (const name of listDirs(skillsDir)) {
    const dir = path.join(skillsDir, name);
    const files = fs.readdirSync(dir);
    const hasPrompt = files.some((f) => PROMPT_RE.test(f));
    if (!hasPrompt) {
      findings.push({
        severity: 'error',
        area: 'skills',
        message: `skill \`${name}\` is missing a prompt.md (or prompt.<variant>.md)`,
        file: `skills/${name}`,
      });
    }
    for (const required of REQUIRED_SKILL_FILES) {
      if (!files.includes(required)) {
        findings.push({
          severity: 'error',
          area: 'skills',
          message: `skill \`${name}\` is missing \`${required}\``,
          file: `skills/${name}`,
        });
      }
    }
  }
  return findings;
}

export function extractRoleUnion(typesSrc: string): string[] {
  // Match `export type Role =` followed by union members until the next semicolon.
  const m = typesSrc.match(/export\s+type\s+Role\s*=\s*([^;]+);/);
  if (!m) return [];
  const body = m[1];
  return Array.from(body.matchAll(/'([a-z-]+)'/g)).map((g) => g[1]);
}

export function extractClaudeRoleList(claudeMd: string): string[] {
  // Find the "Role —" bullet in the domain vocabulary.
  const m = claudeMd.match(/-\s+\*\*Role\*\*\s+—\s+([^\n]+)/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/\.$/, '').toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean);
}

/**
 * Pure comparison: canonical roles (from core/types.ts) vs claimed roles
 * (from CLAUDE.md). Exported so tests can verify the comparison logic
 * without depending on the live state of either file.
 *
 * `advisor` in CLAUDE.md is a model-tier *concept*, not a Role-union member,
 * so it is treated as expected when claimed but missing from canonical.
 */
export function compareRoleLists(canonical: string[], claimed: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const role of canonical) {
    if (!claimed.includes(role)) {
      findings.push({
        severity: 'warn',
        area: 'roles',
        message: `Role \`${role}\` exists in core/types.ts but is not listed in CLAUDE.md domain vocabulary`,
        file: 'CLAUDE.md',
      });
    }
  }
  for (const role of claimed) {
    if (role === 'advisor') continue;
    if (!canonical.includes(role)) {
      findings.push({
        severity: 'warn',
        area: 'roles',
        message: `Role \`${role}\` is listed in CLAUDE.md but not in the core/types.ts Role union`,
        file: 'CLAUDE.md',
      });
    }
  }
  return findings;
}

export function auditRolesInClaude(repoRoot: string): Finding[] {
  const typesPath = path.join(repoRoot, 'core', 'types.ts');
  const claudePath = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(typesPath) || !fs.existsSync(claudePath)) {
    return [
      {
        severity: 'error',
        area: 'roles',
        message: 'core/types.ts or CLAUDE.md is missing — cannot compare role list',
      },
    ];
  }
  const canonical = extractRoleUnion(fs.readFileSync(typesPath, 'utf8'));
  const claimed = extractClaudeRoleList(fs.readFileSync(claudePath, 'utf8'));
  return compareRoleLists(canonical, claimed);
}

const CANONICAL_FILE_REFS = [
  'core/state-source/dependency-parser.ts',
  'core/agent-runtime/read-prompt.ts',
  'core/agent-runtime/decision-types.ts',
  'core/orchestrator',
];

export function auditFileReferences(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  for (const rel of CANONICAL_FILE_REFS) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      findings.push({
        severity: 'error',
        area: 'refs',
        message: `Canonical reference \`${rel}\` is missing — CLAUDE.md/FACTORY_RULES.md point at it`,
      });
    }
  }
  return findings;
}

export function extractClaudeMilestoneSpan(claudeMd: string): { lo: number; hi: number } | null {
  const m = claudeMd.match(/M(\d+)\s*[–-]\s*M(\d+)/);
  if (!m) return null;
  return { lo: Number(m[1]), hi: Number(m[2]) };
}

export function extractProjectActiveMilestone(configSrc: string): number | null {
  // Match `activeMilestone: 'M19: ...'` or similar.
  const m = configSrc.match(/activeMilestone\s*:\s*['"]M(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Pure comparison: parsed CLAUDE.md milestone span vs active milestone
 * from a target-project config. Exported so tests can drive it with
 * fixtures rather than the live (drifting) state of CLAUDE.md.
 */
export function compareMilestoneSpan(
  span: { lo: number; hi: number } | null,
  active: number | null,
): Finding[] {
  if (!span || active === null) return [];
  if (active <= span.hi) return [];
  return [
    {
      severity: 'warn',
      area: 'milestone',
      message: `CLAUDE.md claims milestones M${span.lo}–M${span.hi}, but goose-hub-self is on M${active}. Update the span.`,
      file: 'CLAUDE.md',
    },
  ];
}

export function auditMilestoneSpan(repoRoot: string): Finding[] {
  const claudePath = path.join(repoRoot, 'CLAUDE.md');
  const configPath = path.join(repoRoot, 'target-projects', 'goose-hub-self', 'project.config.ts');
  if (!fs.existsSync(claudePath) || !fs.existsSync(configPath)) return [];
  const span = extractClaudeMilestoneSpan(fs.readFileSync(claudePath, 'utf8'));
  const active = extractProjectActiveMilestone(fs.readFileSync(configPath, 'utf8'));
  return compareMilestoneSpan(span, active);
}

/**
 * Validate skill references in README.md against the filesystem. Scans for
 * backtick-quoted kebab tokens that sit on the same line as the word "skill"
 * and flags any whose `skills/<name>/` directory doesn't exist.
 *
 * Direction: README → filesystem. README is not required to enumerate every
 * skill (we point at docs/inventory.md instead), so "skill X not mentioned
 * in README" is *not* drift.
 */
export function auditReadmeSkillsCoverage(repoRoot: string): Finding[] {
  const findings: Finding[] = [];
  const readmePath = path.join(repoRoot, 'README.md');
  const skillsDir = path.join(repoRoot, 'skills');
  if (!fs.existsSync(readmePath) || !fs.existsSync(skillsDir)) return findings;
  const readme = fs.readFileSync(readmePath, 'utf8');
  const actualSkills = new Set(listDirs(skillsDir));
  return findStaleSkillRefs(readme, actualSkills);
}

/**
 * Pure helper: extract stale skill references from README text. Matches
 * the precise patterns `skill `<name>``, `skills `<name>``, and ``<name>` skill`
 * (with one optional article like "the"/"a"). Avoids matching arbitrary
 * kebab tokens that happen to share a line with the word "skill".
 */
export function findStaleSkillRefs(readme: string, actualSkills: Set<string>): Finding[] {
  const stale = new Set<string>();
  const patterns = [
    /skills?\s+(?:the\s+|a\s+)?`([a-z][a-z0-9-]+)`/gi,
    /`([a-z][a-z0-9-]+)`\s+skill\b/gi,
  ];
  for (const re of patterns) {
    for (const m of readme.matchAll(re)) {
      const token = m[1];
      if (!token || token.includes('/') || token.includes('.')) continue;
      if (!actualSkills.has(token)) stale.add(token);
    }
  }
  if (stale.size === 0) return [];
  return [
    {
      severity: 'warn',
      area: 'readme',
      message: `README.md references ${stale.size} skill name(s) not present under skills/: ${Array.from(stale).join(', ')}`,
      file: 'README.md',
    },
  ];
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'audit-docs: clean. No drift detected.\n';
  const lines: string[] = [];
  const buckets: Record<Severity, Finding[]> = { error: [], warn: [], info: [] };
  for (const f of findings) buckets[f.severity].push(f);
  for (const sev of ['error', 'warn', 'info'] as const) {
    if (buckets[sev].length === 0) continue;
    lines.push(`${sev.toUpperCase()} (${buckets[sev].length}):`);
    for (const f of buckets[sev]) {
      const where = f.file ? ` [${f.file}]` : '';
      lines.push(`  - [${f.area}]${where} ${f.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const strict = process.argv.includes('--strict');
  const findings = [
    ...auditSkillStructure(repoRoot),
    ...auditRolesInClaude(repoRoot),
    ...auditFileReferences(repoRoot),
    ...auditMilestoneSpan(repoRoot),
    ...auditReadmeSkillsCoverage(repoRoot),
  ];
  process.stdout.write(formatFindings(findings));
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  if (errors > 0) process.exit(1);
  if (strict && warns > 0) process.exit(1);
  process.exit(0);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
