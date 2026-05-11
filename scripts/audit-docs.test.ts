import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditFileReferences,
  auditMilestoneSpan,
  auditReadmeSkillsCoverage,
  auditRolesInClaude,
  auditSkillStructure,
  compareMilestoneSpan,
  compareRoleLists,
  extractClaudeMilestoneSpan,
  extractClaudeRoleList,
  extractProjectActiveMilestone,
  extractRoleUnion,
  findStaleSkillRefs,
  formatFindings,
} from './audit-docs.js';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('auditSkillStructure', () => {
  it('reports no errors against the real skills/ directory', () => {
    const findings = auditSkillStructure(REPO_ROOT);
    const errors = findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) console.error('Skill structure errors:', errors);
    expect(errors).toEqual([]);
  });
});

describe('extractRoleUnion', () => {
  it('parses the canonical Role union from a types-file string', () => {
    const src = "export type Role = 'a' | 'b-c' | 'd';";
    expect(extractRoleUnion(src)).toEqual(['a', 'b-c', 'd']);
  });

  it('returns [] when the Role union is missing', () => {
    expect(extractRoleUnion('export type Other = string;')).toEqual([]);
  });
});

describe('extractClaudeRoleList', () => {
  it('parses the Role vocabulary bullet into kebab-cased tokens', () => {
    const md = '- **Role** — Triager, Griller, PRD-Writer, Dev-Reviewer, QA.\n- **Persona** — …';
    expect(extractClaudeRoleList(md)).toEqual(['triager', 'griller', 'prd-writer', 'dev-reviewer', 'qa']);
  });

  it('returns [] when no Role bullet is found', () => {
    expect(extractClaudeRoleList('# heading\n\nnothing')).toEqual([]);
  });
});

describe('compareRoleLists', () => {
  it('returns no findings when sets match', () => {
    expect(compareRoleLists(['developer', 'qa'], ['developer', 'qa'])).toEqual([]);
  });

  it('flags roles in canonical but missing from claimed', () => {
    const out = compareRoleLists(['developer', 'qa', 'auditor'], ['developer', 'qa']);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('auditor');
    expect(out[0].severity).toBe('error');
  });

  it('flags roles in claimed but missing from canonical', () => {
    const out = compareRoleLists(['developer'], ['developer', 'ghost-role']);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('ghost-role');
  });

  it('treats `advisor` in claimed as expected even when missing from canonical (model-tier concept)', () => {
    expect(compareRoleLists(['developer'], ['developer', 'advisor'])).toEqual([]);
  });
});

describe('auditRolesInClaude (live)', () => {
  it('runs against the live repo without throwing and returns Finding[]', () => {
    expect(Array.isArray(auditRolesInClaude(REPO_ROOT))).toBe(true);
  });
});

describe('auditFileReferences', () => {
  it('confirms canonical referenced files exist', () => {
    const errors = auditFileReferences(REPO_ROOT).filter((f) => f.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('extractClaudeMilestoneSpan', () => {
  it('parses an M0-M18 span (ascii dash)', () => {
    expect(extractClaudeMilestoneSpan('Goose Hub is built M0-M18.')).toEqual({ lo: 0, hi: 18 });
  });

  it('parses an M0–M18 span (en dash)', () => {
    expect(extractClaudeMilestoneSpan('Goose Hub is built M0–M18.')).toEqual({ lo: 0, hi: 18 });
  });

  it('returns null when no span is present', () => {
    expect(extractClaudeMilestoneSpan('no milestones here')).toBeNull();
  });
});

describe('extractProjectActiveMilestone', () => {
  it('parses the activeMilestone number out of a project config', () => {
    expect(extractProjectActiveMilestone("activeMilestone: 'M19: foo'")).toBe(19);
  });

  it('returns null when no activeMilestone is present', () => {
    expect(extractProjectActiveMilestone('export default { tickIntervalSeconds: 60 }')).toBeNull();
  });
});

describe('compareMilestoneSpan', () => {
  it('returns no findings when active milestone is within span', () => {
    expect(compareMilestoneSpan({ lo: 0, hi: 19 }, 19)).toEqual([]);
    expect(compareMilestoneSpan({ lo: 0, hi: 20 }, 19)).toEqual([]);
  });

  it('warns when active milestone exceeds the span hi', () => {
    const out = compareMilestoneSpan({ lo: 0, hi: 18 }, 19);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].message).toContain('M0–M18');
    expect(out[0].message).toContain('M19');
  });

  it('is a no-op when either input is null', () => {
    expect(compareMilestoneSpan(null, 19)).toEqual([]);
    expect(compareMilestoneSpan({ lo: 0, hi: 18 }, null)).toEqual([]);
  });
});

describe('auditMilestoneSpan (live)', () => {
  it('runs against the live repo without throwing and returns Finding[]', () => {
    expect(Array.isArray(auditMilestoneSpan(REPO_ROOT))).toBe(true);
  });
});

describe('findStaleSkillRefs', () => {
  const skills = new Set(['triage', 'qa', 'investigate']);

  it('returns nothing for a README that only mentions real skills', () => {
    const md = 'The `triage` skill classifies items. The `qa` skill holds out.';
    expect(findStaleSkillRefs(md, skills)).toEqual([]);
  });

  it('flags a stale "skill `<name>`" reference', () => {
    const md = 'We run the skill `removed-skill` after triage.';
    const out = findStaleSkillRefs(md, skills);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('removed-skill');
  });

  it('flags a stale "`<name>` skill" reference', () => {
    const md = 'The `ghost-skill` skill no longer exists.';
    const out = findStaleSkillRefs(md, skills);
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('ghost-skill');
  });

  it('ignores backtick tokens that are not adjacent to the word "skill"', () => {
    const md = 'The workflow `triage-batch` runs every tick. `contextAllowlist` is enforced.';
    expect(findStaleSkillRefs(md, skills)).toEqual([]);
  });
});

describe('auditReadmeSkillsCoverage (live)', () => {
  it('returns no findings for the current README (no stale skill refs)', () => {
    expect(auditReadmeSkillsCoverage(REPO_ROOT)).toEqual([]);
  });
});

describe('formatFindings', () => {
  it('groups findings by severity and produces a non-empty string when findings exist', () => {
    const out = formatFindings([
      { severity: 'error', area: 'skills', message: 'foo missing prompt.md', file: 'skills/foo' },
      { severity: 'warn', area: 'roles', message: 'role bar missing from CLAUDE.md', file: 'CLAUDE.md' },
      { severity: 'info', area: 'milestone', message: 'all good' },
    ]);
    expect(out).toContain('ERROR');
    expect(out).toContain('WARN');
    expect(out).toContain('foo missing prompt.md');
    expect(out).toContain('role bar missing from CLAUDE.md');
  });

  it('returns a clean message when there are no findings', () => {
    expect(formatFindings([])).toContain('clean');
  });
});
