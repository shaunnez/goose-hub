import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export class FactoryContextError extends Error {
  readonly kind = 'FactoryContextError' as const;
  readonly missing: ReadonlyArray<string>;

  constructor(missing: ReadonlyArray<string>) {
    super(`factory-tools MCP server missing required env: ${missing.join(', ')}`);
    this.name = 'FactoryContextError';
    this.missing = missing;
  }
}

export interface FactoryContext {
  runId: string;
  projectId: string;
  workItemId: string;
  skill?: string | null;
  personaId?: string | null;
  workspaceRoot: string;
  serverPort: number;
}

/**
 * Required env: the run identifies a project + workspace + server port at
 * minimum. `FACTORY_WORK_ITEM_ID` is *not* in this list because project-
 * level / ad-hoc skill invocations have no work item; tools that need one
 * (`get_work_item`, `check_acceptance_criteria`) throw on their own when
 * the field is empty.
 */
const REQUIRED_ENV = [
  'FACTORY_RUN_ID',
  'FACTORY_PROJECT_ID',
  'FACTORY_WORKSPACE_DIR',
  'FACTORY_SERVER_PORT',
] as const;

/**
 * Reads run-scoped identity from env. The server is restarted per run, so the
 * context is captured once at bootstrap and shared by every tool handler.
 *
 * The agent has no path or argument by which it can override these values —
 * `workspaceRoot` is never accepted as a tool argument by contract.
 */
export function loadFactoryContext(env: NodeJS.ProcessEnv = process.env): FactoryContext {
  const missing = REQUIRED_ENV.filter((key) => {
    const value = env[key];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0) throw new FactoryContextError(missing);

  const workspaceRoot = resolve(env.FACTORY_WORKSPACE_DIR as string);
  if (!existsSync(workspaceRoot) || !statSync(workspaceRoot).isDirectory()) {
    throw new FactoryContextError(['FACTORY_WORKSPACE_DIR']);
  }

  const serverPort = Number.parseInt(env.FACTORY_SERVER_PORT as string, 10);
  if (!Number.isInteger(serverPort) || serverPort <= 0 || serverPort > 65_535) {
    throw new FactoryContextError(['FACTORY_SERVER_PORT']);
  }

  return {
    runId: (env.FACTORY_RUN_ID as string).trim(),
    projectId: (env.FACTORY_PROJECT_ID as string).trim(),
    // Empty string means "no work item" for project-level / ad-hoc runs.
    workItemId: (env.FACTORY_WORK_ITEM_ID ?? '').trim(),
    skill: (env.FACTORY_SKILL ?? '').trim() || null,
    personaId: (env.FACTORY_PERSONA_ID ?? '').trim() || null,
    workspaceRoot,
    serverPort,
  };
}
