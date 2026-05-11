import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO_ROOT = join(import.meta.dirname, '../../../..');

export function sliceUrl(sliceName: string): string {
  return new URL(`slices/${sliceName}/workflow.js`, pathToFileURL(`${REPO_ROOT}/`)).href;
}
