import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Filesystem root of the @goose-hub/target-projects package.
 *
 * Apps that need to walk the on-disk layout (e.g. listing project slugs,
 * loading per-project markdown files) should derive paths from this constant
 * rather than reaching back through `../../target-projects` from their own
 * source tree (FACTORY_RULES rule 28a).
 */
export const targetProjectsRoot: string = path.dirname(fileURLToPath(import.meta.url));
