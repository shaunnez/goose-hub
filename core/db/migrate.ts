import { db } from './db.js';

// Programmatic entry point: ensures ~/.factory/data/ exists and the DB file is
// created. Table creation is handled by `pnpm db:migrate` (drizzle-kit push).
console.log('DB ready at', db);
