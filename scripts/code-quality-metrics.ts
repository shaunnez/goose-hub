#!/usr/bin/env npx tsx
/**
 * code-quality-metrics
 *
 * Computes automated metrics for the code-quality-audit skill:
 * - Cat 5: LOC Discipline (percentage of source files under 200 SLOC)
 * - Cat 6: Coupling / Fan-Out (imports per file)
 * - Cat 8: Cyclomatic Complexity (percentage of functions with CC <= 10)
 *
 * Usage:
 *   npx tsx scripts/code-quality-metrics.ts [--repo-path <path>] [--ext ts,js] [--json]
 *
 * Outputs JSON conforming to CodeQualityAuditContextSchema.metricsJson.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const repoPath = getArg('--repo-path') ?? process.cwd();
const extensions = (getArg('--ext') ?? 'ts,tsx,js,jsx').split(',');
const outputJson = args.includes('--json');

// ─── File discovery ───────────────────────────────────────────────────────────

function findSourceFiles(root: string, exts: string[]): string[] {
  const extPattern = exts.map((e) => `"*.${e}"`).join(' -o -name ');
  const excludes = [
    '-not -path "*/node_modules/*"',
    '-not -path "*/.git/*"',
    '-not -path "*/dist/*"',
    '-not -path "*/build/*"',
    '-not -path "*/.factory/*"',
    '-not -path "*/.worktrees/*"',
    '-not -name "*.d.ts"',
    '-not -name "*.min.*"',
  ].join(' ');

  try {
    const cmd = `find ${root} \\( -name ${extPattern} \\) ${excludes}`;
    const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return output
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Cat 5: LOC Discipline ────────────────────────────────────────────────────

interface LocResult {
  score: number;
  pctUnder200: number;
  filesOver200: Array<{ file: string; lines: number }>;
  totalFiles: number;
}

function countNonBlankLines(content: string): number {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .length;
}

function computeLocDiscipline(files: string[]): LocResult {
  const over200: Array<{ file: string; lines: number }> = [];

  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const sloc = countNonBlankLines(content);
      if (sloc > 200) over200.push({ file: f, lines: sloc });
    } catch {
      // skip unreadable files
    }
  }

  const total = files.length;
  const pctUnder200 = total === 0 ? 100 : Math.round(((total - over200.length) / total) * 100);

  let score: number;
  if (pctUnder200 === 100) score = 10;
  else if (pctUnder200 >= 90) score = 8;
  else if (pctUnder200 >= 70) score = 5;
  else if (pctUnder200 >= 50) score = 3;
  else score = 0;

  return { score, pctUnder200, filesOver200: over200.sort((a, b) => b.lines - a.lines), totalFiles: total };
}

// ─── Cat 6: Coupling / Fan-Out ────────────────────────────────────────────────

interface CouplingResult {
  score: number;
  avgImports: number;
  maxImports: number;
  maxFile: string;
  filesAtCritical: Array<{ file: string; imports: number }>;
}

const CRITICAL_THRESHOLD = 9;

function countImports(content: string): number {
  const lines = content.split('\n');
  return lines.filter(
    (line) =>
      /^\s*import\s/.test(line) ||
      /^\s*const\s+\w+\s*=\s*require\(/.test(line),
  ).length;
}

function computeCoupling(files: string[]): CouplingResult {
  const counts: Array<{ file: string; imports: number }> = [];

  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const imports = countImports(content);
      counts.push({ file: f, imports });
    } catch {
      // skip
    }
  }

  if (counts.length === 0) {
    return { score: 10, avgImports: 0, maxImports: 0, maxFile: '', filesAtCritical: [] };
  }

  const total = counts.reduce((s, c) => s + c.imports, 0);
  const avgImports = Math.round((total / counts.length) * 10) / 10;
  const sorted = [...counts].sort((a, b) => b.imports - a.imports);
  const maxImports = sorted[0].imports;
  const maxFile = sorted[0].file;
  const filesAtCritical = sorted.filter((c) => c.imports >= CRITICAL_THRESHOLD);

  let score: number;
  if (filesAtCritical.length === 0) score = 10;
  else if (filesAtCritical.length === 1) score = 7;
  else if (filesAtCritical.length <= 3) score = 5;
  else if (filesAtCritical.length <= 6) score = 3;
  else score = 0;

  return { score, avgImports, maxImports, maxFile, filesAtCritical };
}

// ─── Cat 8: Cyclomatic Complexity ─────────────────────────────────────────────

interface ComplexityResult {
  score: number;
  pctUnder10: number;
  functionsOver10: Array<{ file: string; name: string; cc: number }>;
}

function estimateCyclomaticComplexity(content: string): Array<{ name: string; cc: number }> {
  const results: Array<{ name: string; cc: number }> = [];

  // Match function declarations, methods, arrow functions with bodies
  const fnPattern = /(?:function\s+(\w+)|(?:(\w+)\s*[=:]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)))\s*\(/g;
  let match: RegExpExecArray | null;

  // Split into rough function bodies by tracking brace depth
  const lines = content.split('\n');
  let inFn = false;
  let fnName = '';
  let braceDepth = 0;
  let fnStart = -1;
  let cc = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFn) {
      const fnMatch = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\()/.exec(line);
      if (fnMatch) {
        inFn = true;
        fnName = fnMatch[1] ?? fnMatch[2] ?? '<anonymous>';
        fnStart = i;
        braceDepth = 0;
        cc = 1;
      }
    }

    if (inFn) {
      // Count control flow keywords that add branches
      const branchMatches = line.match(/\b(if|else\s+if|for|while|case|catch)\b/g) ?? [];
      const logicalMatches = line.match(/(\&\&|\|\||\?(?!:))/g) ?? [];
      cc += branchMatches.length + logicalMatches.length;

      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') {
          braceDepth--;
          if (braceDepth <= 0 && fnStart !== -1) {
            results.push({ name: fnName, cc });
            inFn = false;
            fnName = '';
            braceDepth = 0;
            cc = 1;
            fnStart = -1;
          }
        }
      }
    }
  }

  // Fallback: use regex for remaining patterns (arrow functions etc.)
  fnPattern.lastIndex = 0;
  while ((match = fnPattern.exec(content)) !== null) {
    const name = match[1] ?? match[2] ?? '<anonymous>';
    if (!results.find((r) => r.name === name)) {
      // Estimate CC from the surrounding 50 chars
      const snippet = content.slice(match.index, match.index + 200);
      const branches = (snippet.match(/\b(if|for|while|case|catch|&&|\|\||\?(?!:))\b/g) ?? []).length;
      results.push({ name, cc: 1 + branches });
    }
  }

  return results;
}

function computeCyclomaticComplexity(files: string[]): ComplexityResult {
  const over10: Array<{ file: string; name: string; cc: number }> = [];
  let totalFunctions = 0;

  for (const f of files) {
    // Only analyze TypeScript/JavaScript source
    if (!f.endsWith('.ts') && !f.endsWith('.tsx') && !f.endsWith('.js') && !f.endsWith('.jsx')) continue;
    try {
      const content = readFileSync(f, 'utf8');
      const fns = estimateCyclomaticComplexity(content);
      totalFunctions += fns.length;
      for (const fn of fns) {
        if (fn.cc > 10) {
          over10.push({ file: f, name: fn.name, cc: fn.cc });
        }
      }
    } catch {
      // skip
    }
  }

  const pctUnder10 = totalFunctions === 0
    ? 100
    : Math.round(((totalFunctions - over10.length) / totalFunctions) * 100);

  let score: number;
  if (pctUnder10 === 100) score = 5;
  else if (pctUnder10 >= 90) score = 4;
  else if (pctUnder10 >= 80) score = 3;
  else if (pctUnder10 >= 60) score = 1;
  else score = 0;

  return { score, pctUnder10, functionsOver10: over10.sort((a, b) => b.cc - a.cc) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(repoPath)) {
    console.error(`Error: repo path does not exist: ${repoPath}`);
    process.exit(1);
  }

  const files = findSourceFiles(repoPath, extensions);

  if (files.length === 0) {
    console.error(`Warning: no source files found in ${repoPath} for extensions [${extensions.join(', ')}]`);
  }

  const loc = computeLocDiscipline(files);
  const coupling = computeCoupling(files);
  const complexity = computeCyclomaticComplexity(files);

  const result = {
    locDiscipline: {
      score: loc.score,
      pctUnder200: loc.pctUnder200,
      totalFiles: loc.totalFiles,
      filesOver200: loc.filesOver200,
    },
    coupling: {
      score: coupling.score,
      avgImports: coupling.avgImports,
      maxImports: coupling.maxImports,
      maxFile: coupling.maxFile,
      filesAtCritical: coupling.filesAtCritical,
    },
    cyclomaticComplexity: {
      score: complexity.score,
      pctUnder10: complexity.pctUnder10,
      functionsOver10: complexity.functionsOver10,
    },
    fileCount: files.length,
    scannedAt: new Date().toISOString(),
  };

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n=== Code Quality Metrics ===\n');
    console.log(`Files scanned: ${files.length}`);
    console.log(`\nCat 5 — LOC Discipline: ${loc.score}/10 (${loc.pctUnder200}% under 200 SLOC)`);
    if (loc.filesOver200.length > 0) {
      console.log('  Files over 200 SLOC:');
      for (const f of loc.filesOver200.slice(0, 10)) {
        console.log(`    ${f.lines} lines: ${f.file.replace(repoPath + '/', '')}`);
      }
    }
    console.log(`\nCat 6 — Coupling/Fan-Out: ${coupling.score}/10 (avg ${coupling.avgImports} imports, max ${coupling.maxImports})`);
    if (coupling.filesAtCritical.length > 0) {
      console.log(`  Files at critical fan-out (>=${CRITICAL_THRESHOLD} imports):`);
      for (const f of coupling.filesAtCritical.slice(0, 10)) {
        console.log(`    ${f.imports} imports: ${f.file.replace(repoPath + '/', '')}`);
      }
    }
    console.log(`\nCat 8 — Cyclomatic Complexity: ${complexity.score}/5 (${complexity.pctUnder10}% of functions CC <= 10)`);
    if (complexity.functionsOver10.length > 0) {
      console.log('  Functions with CC > 10:');
      for (const f of complexity.functionsOver10.slice(0, 10)) {
        console.log(`    CC=${f.cc} ${f.name}() in ${f.file.replace(repoPath + '/', '')}`);
      }
    }
    const total = loc.score + coupling.score + complexity.score;
    console.log(`\nAutomated subtotal: ${total}/25`);
    console.log(`\nRun with --json to get machine-readable output for the audit skill.\n`);
  }
}

main();
