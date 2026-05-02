import { and, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { personaRouting } from '../db/schema.js';

const PERSONAS_PER_ROLE = 3;

/**
 * Round-robin persona selector. Returns a stable persona identifier for the given
 * (projectId, role) pair, incrementing the round-robin index in SQLite on each call.
 *
 * Persona ID format: "<projectId>/<role>/<index>" — e.g. "goose-hub-self/investigator/0"
 *
 * Implementation resolves CONTEXT.md decision:
 * - Selection strategy: round-robin within role (option a)
 * - 3 seeded personas per role per project
 * - lastIndex increments by 1 modulo PERSONAS_PER_ROLE on each call
 * - No stats weighting until M9 provides sufficient data
 */
export function selectPersona(projectId: string, role: string): string {
  const existing = db
    .select()
    .from(personaRouting)
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .all();

  let currentIndex: number;

  if (existing.length === 0) {
    // First call for this (projectId, role) pair — insert with lastIndex 0
    db.insert(personaRouting).values({ projectId, role, lastIndex: 0 }).run();
    currentIndex = 0;
  } else {
    currentIndex = existing[0].lastIndex;
  }

  const personaId = `${projectId}/${role}/${currentIndex % PERSONAS_PER_ROLE}`;

  // Advance the index for the next caller
  const nextIndex = (currentIndex + 1) % PERSONAS_PER_ROLE;
  db.update(personaRouting)
    .set({ lastIndex: nextIndex })
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .run();

  return personaId;
}
