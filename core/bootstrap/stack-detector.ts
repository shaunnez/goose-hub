import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeStackInfo {
  type: 'node';
  packageManager: 'pnpm' | 'yarn' | 'npm';
  scripts: {
    build?: string;
    test?: string;
    lint?: string;
    typecheck?: string;
    e2e?: string;
  };
}

export interface PythonStackInfo {
  type: 'python';
  testRunner: 'pytest' | 'unittest';
  lintTool?: 'ruff' | 'flake8';
}

export interface GoStackInfo {
  type: 'go';
  moduleName: string;
  testCommand: string;
  buildCommand: string;
}

export interface RustStackInfo {
  type: 'rust';
  crateName: string;
  testCommand: string;
  buildCommand: string;
}

export interface RubyStackInfo {
  type: 'ruby';
  testRunner: 'rspec' | 'minitest';
}

export interface UnknownStackInfo {
  type: 'unknown';
}

export type StackInfo =
  | NodeStackInfo
  | PythonStackInfo
  | GoStackInfo
  | RustStackInfo
  | RubyStackInfo
  | UnknownStackInfo;

export interface StackFileReader {
  exists(filePath: string): Promise<boolean>;
  readText(filePath: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

async function tryDetectNode(files: StackFileReader): Promise<NodeStackInfo | null> {
  if (!(await files.exists('package.json'))) return null;

  const raw = await files.readText('package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // package.json exists but is unparseable (mid-edit, conflicted merge, etc).
    // Returning null would let lower-priority detectors win and misclassify a
    // Node repo as Python/Go/Rust. Preserve Node priority with empty defaults
    // so the user can fix the manifest after bootstrap.
    return { type: 'node', packageManager: 'npm', scripts: {} };
  }

  const scriptsRaw = pkg.scripts as Record<string, string> | undefined;
  const scripts: NodeStackInfo['scripts'] = {};
  if (scriptsRaw) {
    if (scriptsRaw.build) scripts.build = scriptsRaw.build;
    if (scriptsRaw.test) scripts.test = scriptsRaw.test;
    if (scriptsRaw.lint) scripts.lint = scriptsRaw.lint;
    if (scriptsRaw.typecheck) scripts.typecheck = scriptsRaw.typecheck;
    if (scriptsRaw.e2e) scripts.e2e = scriptsRaw.e2e;
  }

  // Detect package manager: packageManager field > lockfile presence
  let packageManager: NodeStackInfo['packageManager'] = 'npm';
  const pmField = typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
  if (pmField.startsWith('pnpm')) {
    packageManager = 'pnpm';
  } else if (pmField.startsWith('yarn')) {
    packageManager = 'yarn';
  } else if (await files.exists('pnpm-lock.yaml')) {
    packageManager = 'pnpm';
  } else if (await files.exists('yarn.lock')) {
    packageManager = 'yarn';
  }

  return { type: 'node', packageManager, scripts };
}

async function tryDetectPython(files: StackFileReader): Promise<PythonStackInfo | null> {
  const hasPyproject = await files.exists('pyproject.toml');
  const hasRequirements = await files.exists('requirements.txt');

  if (!hasPyproject && !hasRequirements) return null;

  let testRunner: PythonStackInfo['testRunner'] = 'unittest';
  let lintTool: PythonStackInfo['lintTool'];

  if (hasPyproject) {
    const content = await files.readText('pyproject.toml');
    // Detect pytest: [tool.pytest.*] section or pytest in dependencies
    if (/\[tool\.pytest/i.test(content) || /\bpytest\b/.test(content)) {
      testRunner = 'pytest';
    }
    // Detect lint tool
    if (/\[tool\.ruff\]/i.test(content) || /\bruff\b/.test(content)) {
      lintTool = 'ruff';
    } else if (/\[tool\.flake8\]/i.test(content) || /\bflake8\b/.test(content)) {
      lintTool = 'flake8';
    }
  }

  return { type: 'python', testRunner, ...(lintTool ? { lintTool } : {}) };
}

async function tryDetectGo(files: StackFileReader): Promise<GoStackInfo | null> {
  if (!(await files.exists('go.mod'))) return null;

  const content = await files.readText('go.mod');

  // Extract module name: first non-comment line starting with "module ".
  // Strip any trailing inline comment (e.g. `module example.com/app // root`).
  let moduleName = '';
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('module ')) {
      const rest = trimmed.slice('module '.length);
      const commentIdx = rest.indexOf('//');
      moduleName = (commentIdx >= 0 ? rest.slice(0, commentIdx) : rest).trim();
      break;
    }
  }

  return {
    type: 'go',
    moduleName,
    testCommand: 'go test ./...',
    buildCommand: 'go build ./...',
  };
}

async function tryDetectRust(files: StackFileReader): Promise<RustStackInfo | null> {
  if (!(await files.exists('Cargo.toml'))) return null;

  const content = await files.readText('Cargo.toml');

  // Extract crate name from [package] section
  let crateName = '';
  let inPackageSection = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '[package]') {
      inPackageSection = true;
      continue;
    }
    if (inPackageSection && trimmed.startsWith('[')) {
      // Entered a new section
      inPackageSection = false;
    }
    if (inPackageSection) {
      const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        crateName = nameMatch[1];
        break;
      }
    }
  }

  return {
    type: 'rust',
    crateName,
    testCommand: 'cargo test',
    buildCommand: 'cargo build',
  };
}

async function tryDetectRuby(files: StackFileReader): Promise<RubyStackInfo | null> {
  if (!(await files.exists('Gemfile'))) return null;

  const content = await files.readText('Gemfile');

  // Detect test runner
  let testRunner: RubyStackInfo['testRunner'] = 'minitest';
  if (/\brspec\b/i.test(content)) {
    testRunner = 'rspec';
  }

  return { type: 'ruby', testRunner };
}

// ---------------------------------------------------------------------------
// Priority-ordered detection
// ---------------------------------------------------------------------------

/**
 * Ordered list of detectors. Earlier entries take priority when multiple
 * manifests coexist (e.g. a Node project that also has a requirements.txt).
 * Priority: Node > Python > Go > Rust > Ruby
 */
const DETECTORS = [
  tryDetectNode,
  tryDetectPython,
  tryDetectGo,
  tryDetectRust,
  tryDetectRuby,
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function detectStack(repoPath: string): Promise<StackInfo> {
  return detectStackFromFiles({
    exists: (filePath) => fileExists(path.join(repoPath, filePath)),
    readText: (filePath) => readText(path.join(repoPath, filePath)),
  });
}

export async function detectStackFromFiles(files: StackFileReader): Promise<StackInfo> {
  for (const detect of DETECTORS) {
    const result = await detect(files);
    if (result !== null) return result;
  }
  return { type: 'unknown' };
}
