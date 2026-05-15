import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function argValue(name: string): string | null {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : (process.argv[idx + 1] ?? null);
}

const issue = argValue('--issue');
const spec = argValue('--spec');
const output = argValue('--output');

if (issue == null || spec == null || output == null) {
  console.error('Usage: pnpm tsx scripts/collect-playwright-evidence.ts --issue <N> --spec <path> --output <dir>');
  process.exit(2);
}

const repoRoot = process.cwd();
const outputDir = resolve(repoRoot, output);
mkdirSync(outputDir, { recursive: true });

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function specSlug(specPath: string): string {
  return normalise(basename(specPath).replace(/\.(spec|test)\.[tj]sx?$/, ''));
}

function newestWebm(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let best: { path: string; mtimeMs: number } | null = null;
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (entry.endsWith('.webm') && (best == null || stat.mtimeMs > best.mtimeMs)) {
        best = { path, mtimeMs: stat.mtimeMs };
      }
    }
  };
  visit(dir);
  return best?.path ?? null;
}

function newestDirectWebm(dir: string): string | null {
  let best: { path: string; mtimeMs: number } | null = null;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (!stat.isDirectory() && entry.endsWith('.webm') && (best == null || stat.mtimeMs > best.mtimeMs)) {
      best = { path, mtimeMs: stat.mtimeMs };
    }
  }
  return best?.path ?? null;
}

function newestResultDir(root: string, slug: string): { path: string; startedAtMs: number } | null {
  if (!existsSync(root)) return null;
  let fallback: { path: string; mtimeMs: number; startedAtMs: number } | null = null;
  let matched: { path: string; mtimeMs: number; startedAtMs: number } | null = null;
  const visit = (current: string): void => {
    const stat = statSync(current);
    const directWebm = newestDirectWebm(current);
    if (directWebm != null) {
      const candidate = { path: current, mtimeMs: stat.mtimeMs, startedAtMs: stat.birthtimeMs };
      if (fallback == null || candidate.mtimeMs > fallback.mtimeMs) fallback = candidate;
      if (
        normalise(basename(current)).includes(slug) &&
        (matched == null || candidate.mtimeMs > matched.mtimeMs)
      ) {
        matched = candidate;
      }
    }
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) visit(path);
    }
  };
  visit(root);
  return matched ?? fallback;
}

const resultDir = newestResultDir(join(repoRoot, 'apps', 'web', 'test-results'), specSlug(spec));
const runStartedAtMs = resultDir?.startedAtMs ?? 0;
const screenshotSources = [
  join(repoRoot, 'evidence', `issue-${issue}`),
  join(repoRoot, 'apps', 'web', 'evidence', `issue-${issue}`),
].filter((path) => existsSync(path));

const screenshots: string[] = [];
let step = 1;
for (const dir of screenshotSources) {
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.png')) continue;
    const source = join(dir, entry);
    if (runStartedAtMs > 0 && statSync(source).mtimeMs < runStartedAtMs - 1000) continue;
    const target = join(outputDir, `step-${step}.png`);
    copyFileSync(source, target);
    screenshots.push(target);
    step += 1;
  }
}

const webmPath = resultDir == null ? null : newestWebm(resultDir.path);
const result = {
  issue,
  spec,
  outputDir,
  resultDir: resultDir?.path ?? null,
  screenshots: screenshots.map((path) => ({ path, file: basename(path) })),
  webmPath,
  gifPath: webmPath == null ? null : join(outputDir, 'walkthrough.gif'),
};

console.log(JSON.stringify(result, null, 2));
