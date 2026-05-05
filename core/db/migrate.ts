import { db } from './db.js';

// Programmatic entry point: ensures ~/.factory/data/ exists and the DB file is
// created. Migrations are applied automatically by db.ts on import via migrate().
// To create a new migration after a schema change: pnpm db:generate
// To apply manually: pnpm db:migrate
console.log('DB ready at', db);
