import { and, count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { personaNames, personaRouting } from '../db/schema.js';
import { selectPersona } from './select-persona.js';

beforeEach(() => {
  db.delete(personaRouting).run();
  db.delete(personaNames).run();
});

describe('selectPersona', () => {
  it('returns object with personaId and codename', () => {
    const result = selectPersona('proj', 'developer');
    expect(result).toHaveProperty('personaId');
    expect(result).toHaveProperty('codename');
    expect(typeof result.personaId).toBe('string');
    expect(typeof result.codename).toBe('string');
  });

  it('personaId format is projectId/role/index', () => {
    const { personaId } = selectPersona('my-proj', 'developer');
    expect(personaId).toMatch(/^my-proj\/developer\/\d+$/);
  });

  it('creates a personaNames entry on first call for a slot', () => {
    selectPersona('proj', 'qa');
    const rows = db.select().from(personaNames).where(eq(personaNames.projectId, 'proj')).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].codename).toBeTruthy();
  });

  it('returns the same codename on repeated calls for the same slot', () => {
    const first = selectPersona('proj', 'developer');
    selectPersona('proj', 'developer');
    selectPersona('proj', 'developer');
    const fourth = selectPersona('proj', 'developer');
    // 3 personas per role — 4th call wraps back to slot 0
    expect(fourth.codename).toBe(first.codename);
    expect(fourth.personaId).toBe(first.personaId);
  });

  it('different slots get different codenames', () => {
    const a = selectPersona('proj', 'developer');
    const b = selectPersona('proj', 'developer');
    const c = selectPersona('proj', 'developer');
    expect(new Set([a.codename, b.codename, c.codename]).size).toBe(3);
  });
});
