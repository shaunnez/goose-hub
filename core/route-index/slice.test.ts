import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouteIndex } from './builder.js';
import { defaultRouteIndexDbPath, openRouteIndexDb, routeIndexDbPathForWorktree } from './db.js';
import { assessRouteIndexFreshness, ensureRouteIndexFresh } from './freshness.js';
import { findComponentUsages, lookupRoute, routeForComponent } from './lookup.js';

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function fileMtime(pathValue: string): number | null {
  return fs.existsSync(pathValue) ? fs.statSync(pathValue).mtimeMs : null;
}

describe('route-index', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'route-index-'));
    dbPath = path.join(tmp, 'route-index.db');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to ~/.factory/route-index.db', () => {
    expect(defaultRouteIndexDbPath()).toContain(path.join('.factory', 'route-index.db'));
  });

  it('builds routes and component usages from TSX files', () => {
    writeFile(
      tmp,
      'apps/web/src/App.tsx',
      `
import { Route } from 'react-router-dom';
import { Button } from './components/ui/button';
function ProjectPage() {
  return <Button variant="destructive" />;
}
export function App() {
  return <Route path="/projects/:slug" element={<ProjectPage />} />;
}
`,
    );

    const result = buildRouteIndex({ repoRoot: tmp, dbPath });
    expect(result.routesIndexed).toBe(1);
    expect(result.componentUsagesIndexed).toBeGreaterThanOrEqual(2);

    expect(lookupRoute('/projects/:slug', { dbPath })).toEqual([
      {
        pathPattern: '/projects/:slug',
        filePath: 'apps/web/src/App.tsx',
        line: 8,
        component: 'ProjectPage',
      },
    ]);
    expect(findComponentUsages('Button', { dbPath })).toEqual([
      { component: 'Button', filePath: 'apps/web/src/App.tsx', line: 5 },
    ]);
    expect(routeForComponent('ProjectPage', { dbPath })).toEqual([
      {
        pathPattern: '/projects/:slug',
        filePath: 'apps/web/src/App.tsx',
        line: 8,
        component: 'ProjectPage',
      },
    ]);
    expect(routeForComponent('Button', { dbPath })).toEqual([]);
  });

  it('uses a per-worktree DB for route lookup when worktreePath is provided without dbPath', () => {
    writeFile(
      tmp,
      'apps/web/src/App.tsx',
      `
function ProjectPage() {
  return null;
}
export function App() {
  return <Route path="/projects/:slug" element={<ProjectPage />} />;
}
`,
    );

    expect(lookupRoute('/projects/:slug', { worktreePath: tmp })).toEqual([
      {
        pathPattern: '/projects/:slug',
        filePath: 'apps/web/src/App.tsx',
        line: 6,
        component: 'ProjectPage',
      },
    ]);
    expect(fs.existsSync(routeIndexDbPathForWorktree(tmp))).toBe(true);
  });

  it('lazily rebuilds a stale per-worktree route DB', () => {
    writeFile(
      tmp,
      'apps/web/src/App.tsx',
      `
export function App() {
  return <Route path="/projects/:slug" element={<ProjectPage />} />;
}
function ProjectPage() {
  return null;
}
`,
    );
    expect(lookupRoute('/projects/:slug', { worktreePath: tmp })).toHaveLength(1);

    writeFile(
      tmp,
      'apps/web/src/NewRoute.tsx',
      `
export function NewRoute() {
  return <Route path="/settings" element={<SettingsPage />} />;
}
function SettingsPage() {
  return null;
}
`,
    );

    expect(lookupRoute('/settings', { worktreePath: tmp })).toEqual([
      {
        pathPattern: '/settings',
        filePath: 'apps/web/src/NewRoute.tsx',
        line: 3,
        component: 'SettingsPage',
      },
    ]);
  });

  it('isolates per-worktree route indexes and does not touch the global route DB', () => {
    const globalBefore = fileMtime(defaultRouteIndexDbPath());
    const worktreeA = path.join(tmp, 'worktree-a');
    const worktreeB = path.join(tmp, 'worktree-b');
    writeFile(
      worktreeA,
      'apps/web/src/App.tsx',
      'export function App() { return <Route path="/alpha" element={<AlphaPage />} />; }',
    );
    writeFile(
      worktreeB,
      'apps/web/src/App.tsx',
      'export function App() { return <Route path="/beta" element={<BetaPage />} />; }',
    );

    expect(lookupRoute('/alpha', { worktreePath: worktreeA })).toMatchObject([
      { pathPattern: '/alpha', filePath: 'apps/web/src/App.tsx' },
    ]);
    expect(lookupRoute('/beta', { worktreePath: worktreeA })).toEqual([]);
    expect(lookupRoute('/beta', { worktreePath: worktreeB })).toMatchObject([
      { pathPattern: '/beta', filePath: 'apps/web/src/App.tsx' },
    ]);
    expect(lookupRoute('/alpha', { worktreePath: worktreeB })).toEqual([]);
    expect(fileMtime(defaultRouteIndexDbPath())).toBe(globalBefore);
  });

  it('reports missing and stale indexes without throwing', () => {
    expect(assessRouteIndexFreshness({ repoRoot: tmp, dbPath })).toMatchObject({ missing: true });

    writeFile(tmp, 'apps/web/src/App.tsx', 'export function App() { return null; }');
    buildRouteIndex({ repoRoot: tmp, dbPath });
    const db = openRouteIndexDb(dbPath);
    db.prepare('UPDATE files SET mtime_ms = 0').run();
    db.close();

    expect(assessRouteIndexFreshness({ repoRoot: tmp, dbPath })).toMatchObject({ stale: true });
  });

  it('marks index stale when a new TSX file is added after indexing', () => {
    writeFile(tmp, 'apps/web/src/App.tsx', 'export function App() { return null; }');
    buildRouteIndex({ repoRoot: tmp, dbPath });

    writeFile(tmp, 'apps/web/src/NewRoute.tsx', 'export function NewRoute() { return null; }');

    expect(assessRouteIndexFreshness({ repoRoot: tmp, dbPath })).toMatchObject({
      stale: true,
      staleFiles: ['apps/web/src/NewRoute.tsx'],
    });
  });

  it('removes a corrupt database before rebuilding', () => {
    writeFile(tmp, 'apps/web/src/App.tsx', 'export function App() { return null; }');
    fs.writeFileSync(dbPath, 'not sqlite', 'utf8');

    const freshness = ensureRouteIndexFresh({
      repoRoot: tmp,
      dbPath,
      rebuild: (repoRoot, pathToDb) => buildRouteIndex({ repoRoot, dbPath: pathToDb }),
    });

    expect(freshness).toMatchObject({ corrupt: false, stale: false });
    expect(lookupRoute('/missing', { dbPath })).toEqual([]);
  });

  it('returns null instead of throwing when a corrupt database cannot be refreshed', () => {
    fs.writeFileSync(dbPath, 'not sqlite', 'utf8');

    expect(lookupRoute('/missing', { dbPath })).toBeNull();
  });

  it('returns null without throwing when the per-worktree route DB cannot be rebuilt', () => {
    writeFile(
      tmp,
      'apps/web/src/App.tsx',
      'export function App() { return <Route path="/projects/:slug" element={<ProjectPage />} />; }',
    );
    fs.writeFileSync(path.join(tmp, '.factory'), 'not a directory', 'utf8');

    expect(lookupRoute('/projects/:slug', { worktreePath: tmp })).toBeNull();
  });
});
