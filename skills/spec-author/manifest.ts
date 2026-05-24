import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, resolve, sep } from 'node:path';

function isDirSync(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.factory', 'dist', 'build', '.pnpm']);
const MANIFEST_CAP = 800;

export interface ManifestEntry {
  path: string; // repo-root relative POSIX
  kind: 'file' | 'dir';
}

export function collectScopeManifest(
  repoRoot: string,
  scopeRoots: ReadonlyArray<string>,
): ManifestEntry[] {
  const resolvedRoot = resolve(repoRoot);
  const out: ManifestEntry[] = [];
  for (const scope of scopeRoots) {
    if (out.length >= MANIFEST_CAP) break;
    // Reject absolute paths and traversals outside repoRoot.
    const abs = resolve(repoRoot, scope);
    if (abs !== resolvedRoot && !abs.startsWith(resolvedRoot + sep)) continue;
    if (!existsSync(abs) || !isDirSync(abs)) continue;
    // Derive POSIX-relative path from the resolved root for consistent output.
    const rel = abs === resolvedRoot ? '.' : abs.slice(resolvedRoot.length + sep.length);
    walk(abs, rel, out);
  }
  return out.slice(0, MANIFEST_CAP);
}

function walk(absDir: string, relDir: string, out: ManifestEntry[]): void {
  if (out.length >= MANIFEST_CAP) return;
  out.push({ path: relDir, kind: 'dir' });
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MANIFEST_CAP) return;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const rel = posix.join(relDir, entry.name);
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, rel, out);
    } else if (entry.isFile()) {
      out.push({ path: rel, kind: 'file' });
    }
  }
}
