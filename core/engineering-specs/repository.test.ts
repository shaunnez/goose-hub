import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db.js';
import { engineeringSpecs } from '../db/schema.js';
import { deleteEngineeringSpec, getEngineeringSpec, persistEngineeringSpec } from './repository.js';

const PROJECT = 'engineering-spec-delete-test';
const WORK_ITEM = 'github:shaunnez/goose-hub#1';

describe('engineering spec repository', () => {
  beforeEach(() => {
    db.delete(engineeringSpecs).where(sql`project_id = ${PROJECT}`).run();
  });

  afterEach(() => {
    db.delete(engineeringSpecs).where(sql`project_id = ${PROJECT}`).run();
  });

  it('deletes a persisted per-work-item spec', () => {
    persistEngineeringSpec(PROJECT, WORK_ITEM, 'run-1', { objective: 'fixture' });

    expect(getEngineeringSpec(PROJECT, WORK_ITEM)).not.toBeNull();

    deleteEngineeringSpec(PROJECT, WORK_ITEM);

    expect(getEngineeringSpec(PROJECT, WORK_ITEM)).toBeNull();
  });
});
