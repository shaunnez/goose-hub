import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { personaNames, personaRouting } from '../db/schema.js';
import { generateCodename } from './persona-names.js';

const PERSONAS_PER_ROLE = 3;

export interface PersonaSelection {
  personaId: string;
  codename: string;
}

/**
 * Round-robin persona selector. Returns a stable persona identifier and codename
 * for the given (projectId, role) pair, incrementing the round-robin index in
 * SQLite on each call.
 *
 * Persona ID format: "<projectId>/<role>/<index>" — e.g. "goose-hub-self/investigator/0"
 * Codename: assigned once per slot from the goosey spy name list, stored in personaNames.
 *
 * Implementation resolves CONTEXT.md decision:
 * - Selection strategy: round-robin within role (option a)
 * - 3 seeded personas per role per project
 * - lastIndex increments by 1 modulo PERSONAS_PER_ROLE on each call
 */
export function selectPersona(projectId: string, role: string): PersonaSelection {
  const existing = db
    .select()
    .from(personaRouting)
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .all();

  let currentIndex: number;

  if (existing.length === 0) {
    db.insert(personaRouting).values({ projectId, role, lastIndex: 0 }).run();
    currentIndex = 0;
  } else {
    currentIndex = existing[0].lastIndex;
  }

  const slotIndex = currentIndex % PERSONAS_PER_ROLE;
  const personaId = `${projectId}/${role}/${slotIndex}`;

  // Advance the index for the next caller
  const nextIndex = (currentIndex + 1) % PERSONAS_PER_ROLE;
  db.update(personaRouting)
    .set({ lastIndex: nextIndex })
    .where(and(eq(personaRouting.projectId, projectId), eq(personaRouting.role, role)))
    .run();

  // Assign codename on first creation of this slot; return stored codename on subsequent calls
  const existingName = db
    .select()
    .from(personaNames)
    .where(
      and(
        eq(personaNames.projectId, projectId),
        eq(personaNames.role, role),
        eq(personaNames.slotIndex, slotIndex),
      ),
    )
    .all();

  let codename: string;
  if (existingName.length === 0) {
    const [{ totalSlots }] = db.select({ totalSlots: count() }).from(personaNames).all();
    codename = generateCodename(totalSlots);
    db.insert(personaNames).values({ projectId, role, slotIndex, codename }).run();
  } else {
    codename = existingName[0].codename;
  }

  return { personaId, codename };
}
