import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Filesystem root of the @goose-hub/skills package.
 *
 * Apps that need to load skill assets that aren't JS modules (e.g. `prompt.md`)
 * should derive paths from this constant rather than reaching back through
 * `../../skills` from their own source tree (FACTORY_RULES rule 28a).
 */
export const skillsRoot: string = path.dirname(fileURLToPath(import.meta.url));
