import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './core/db/schema.ts',
  out: './core/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: path.join(os.homedir(), '.factory', 'data', 'factory.db') },
});
