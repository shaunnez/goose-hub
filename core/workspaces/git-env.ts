import type { SpawnSyncOptionsWithBufferEncoding } from 'node:child_process';

const PATH_EXTRAS = '/usr/bin:/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/sbin';

const enrichedPath = (() => {
  const p = process.env.PATH ?? '';
  return p.includes('/usr/bin') ? p : `${p}:${PATH_EXTRAS}`;
})();

export const GIT_ENV: SpawnSyncOptionsWithBufferEncoding['env'] = {
  ...process.env,
  PATH: enrichedPath,
};
