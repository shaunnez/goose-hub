import { count, eq, and } from 'drizzle-orm';
import { db } from '../core/db/db.js';
import { personaNames, personaStats } from '../core/db/schema.js';
import { generateCodename } from '../core/agent-runtime/persona-names.js';

// personaName format: "<projectId>/<role>/<slotIndex>"
// role is a single word, slotIndex is a number — parse from the right.
function parsePersonaName(
  personaName: string,
): { projectId: string; role: string; slotIndex: number } | null {
  const parts = personaName.split('/');
  if (parts.length < 3) return null;
  const slotIndex = Number(parts[parts.length - 1]);
  if (Number.isNaN(slotIndex)) return null;
  const role = parts[parts.length - 2];
  const projectId = parts.slice(0, -2).join('/');
  return { projectId, role, slotIndex };
}

async function main() {
  const stats = await db.select().from(personaStats);
  let inserted = 0;
  let skipped = 0;

  for (const stat of stats) {
    const parsed = parsePersonaName(stat.personaName);
    if (!parsed) {
      console.log(`  skip (unparseable): ${stat.personaName}`);
      skipped++;
      continue;
    }

    const { projectId, role, slotIndex } = parsed;

    const existing = await db
      .select()
      .from(personaNames)
      .where(
        and(
          eq(personaNames.projectId, projectId),
          eq(personaNames.role, role),
          eq(personaNames.slotIndex, slotIndex),
        ),
      );

    if (existing.length > 0) {
      console.log(`  skip (already named): ${stat.personaName} → ${existing[0].codename}`);
      skipped++;
      continue;
    }

    const [{ totalSlots }] = await db.select({ totalSlots: count() }).from(personaNames);
    const codename = generateCodename(totalSlots);

    await db.insert(personaNames).values({ projectId, role, slotIndex, codename });
    console.log(`  backfilled: ${stat.personaName} → ${codename}`);
    inserted++;
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
