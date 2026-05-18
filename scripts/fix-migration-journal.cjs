#!/usr/bin/env node
/**
 * Fix for empty __drizzle_migrations journal with pre-existing tables.
 *
 * The DB was bootstrapped without Drizzle tracking, so the events table (and others
 * from migration 0000) already exist but the journal is empty. This script:
 *   1. Creates the missing tables from migration 0000
 *   2. Marks migration 0000 as applied so Drizzle continues from 0001
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.factory', 'data', 'factory.db');
console.log('DB path:', dbPath);

const db = new Database(dbPath);

// Check which tables already exist
const existing = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
);
console.log('Existing tables:', [...existing].join(', '));

// Create missing tables from migration 0000
if (!existing.has('agent_run_costs')) {
  db.exec(`
    CREATE TABLE \`agent_run_costs\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`run_id\` text NOT NULL,
      \`project_id\` text NOT NULL,
      \`work_item_id\` text,
      \`stage\` text NOT NULL,
      \`skill\` text NOT NULL,
      \`model_id\` text NOT NULL,
      \`input_tokens\` integer DEFAULT 0 NOT NULL,
      \`output_tokens\` integer DEFAULT 0 NOT NULL,
      \`cost_usd\` real DEFAULT 0 NOT NULL,
      \`cost_label\` text DEFAULT 'estimated' NOT NULL,
      \`persona_id\` text,
      \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
    )
  `);
  db.exec("CREATE UNIQUE INDEX `agent_run_costs_run_id_uniq` ON `agent_run_costs` (`run_id`)");
  db.exec("CREATE INDEX `agent_run_costs_project_created_idx` ON `agent_run_costs` (`project_id`,`created_at`)");
  db.exec("CREATE INDEX `agent_run_costs_work_item_idx` ON `agent_run_costs` (`work_item_id`)");
  console.log('Created: agent_run_costs');
} else {
  console.log('Already exists: agent_run_costs');
}

if (!existing.has('improvement_candidates')) {
  db.exec(`
    CREATE TABLE \`improvement_candidates\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`persona_name\` text NOT NULL,
      \`source_task_id\` text,
      \`suggestion_text\` text NOT NULL,
      \`suggestion_type\` text NOT NULL,
      \`project_id\` text DEFAULT '' NOT NULL,
      \`status\` text DEFAULT 'pending' NOT NULL,
      \`github_issue_url\` text,
      \`error_note\` text,
      \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
    )
  `);
  db.exec("CREATE INDEX `improvement_candidates_persona_status_idx` ON `improvement_candidates` (`persona_name`,`status`)");
  console.log('Created: improvement_candidates');
} else {
  console.log('Already exists: improvement_candidates');
}

if (!existing.has('persona_names')) {
  db.exec(`
    CREATE TABLE \`persona_names\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`project_id\` text NOT NULL,
      \`role\` text NOT NULL,
      \`slot_index\` integer NOT NULL,
      \`codename\` text NOT NULL
    )
  `);
  db.exec("CREATE UNIQUE INDEX `persona_names_slot_uniq` ON `persona_names` (`project_id`,`role`,`slot_index`)");
  console.log('Created: persona_names');
} else {
  console.log('Already exists: persona_names');
}

if (!existing.has('persona_stats')) {
  db.exec(`
    CREATE TABLE \`persona_stats\` (
      \`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      \`persona_name\` text NOT NULL,
      \`role\` text NOT NULL,
      \`runs_total\` integer DEFAULT 0 NOT NULL,
      \`runs_succeeded\` integer DEFAULT 0 NOT NULL,
      \`runs_failed\` integer DEFAULT 0 NOT NULL,
      \`avg_quality_score\` real DEFAULT 1 NOT NULL,
      \`last_run_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
    )
  `);
  db.exec("CREATE UNIQUE INDEX `persona_stats_persona_role_uniq` ON `persona_stats` (`persona_name`,`role`)");
  console.log('Created: persona_stats');
} else {
  console.log('Already exists: persona_stats');
}

// Compute SHA-256 hash of migration 0000 (same method Drizzle uses)
const migration0000 = path.join(
  __dirname, '..', 'core', 'db', 'migrations', '0000_red_impossible_man.sql'
);
const content = fs.readFileSync(migration0000).toString();
const hash = crypto.createHash('sha256').update(content).digest('hex');
console.log('Migration 0000 hash:', hash);

// Mark migration 0000 as applied (folderMillis from _journal.json)
const MIGRATION_0000_WHEN = 1777946562070;
const existing_records = db.prepare('SELECT * FROM __drizzle_migrations').all();
if (existing_records.length === 0) {
  db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, MIGRATION_0000_WHEN);
  console.log('Inserted migration 0000 record (created_at:', MIGRATION_0000_WHEN, ')');
} else {
  console.log('Migration journal already has entries, skipping insert');
}

// Verify
const records = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all();
console.log('Migration records after fix:', JSON.stringify(records, null, 2));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('All tables now:', tables.map(r => r.name).join(', '));

db.close();
console.log('\nDone. Drizzle will now apply migrations 0001+ on next startup.');
