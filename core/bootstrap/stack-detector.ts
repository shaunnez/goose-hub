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

async function tryDetectNode(repoPath: string): Promise<NodeStackInfo | null> {
  const manifestPath = path.join(repoPath, 'package.json');
  if (!(await fileExists(manifestPath))) return null;

  const raw = await readText(manifestPath);
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
  } else if (await fileExists(path.join(repoPath, 'pnpm-lock.yaml'))) {
    packageManager = 'pnpm';
  } else if (await fileExists(path.join(repoPath, 'yarn.lock'))) {
    packageManager = 'yarn';
  }

  return { type: 'node', packageManager, scripts };
}

async function tryDetectPython(repoPath: string): Promise<PythonStackInfo | null> {
  const pyprojectPath = path.join(repoPath, 'pyproject.toml');
  const requirementsPath = path.join(repoPath, 'requirements.txt');

  const hasPyproject = await fileExists(pyprojectPath);
  const hasRequirements = await fileExists(requirementsPath);

  if (!hasPyproject && !hasRequirements) return null;

  let testRunner: PythonStackInfo['testRunner'] = 'unittest';
  let lintTool: PythonStackInfo['lintTool'];

  if (hasPyproject) {
    const content = await readText(pyprojectPath);
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

async function tryDetectGo(repoPath: string): Promise<GoStackInfo | null> {
  const goModPath = path.join(repoPath, 'go.mod');
  if (!(await fileExists(goModPath))) return null;

  const content = await readText(goModPath);

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

async function tryDetectRust(repoPath: string): Promise<RustStackInfo | null> {
  const cargoPath = path.join(repoPath, 'Cargo.toml');
  if (!(await fileExists(cargoPath))) return null;

  const content = await readText(cargoPath);

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

async function tryDetectRuby(repoPath: string): Promise<RubyStackInfo | null> {
  const gemfilePath = path.join(repoPath, 'Gemfile');
  if (!(await fileExists(gemfilePath))) return null;

  const content = await readText(gemfilePath);

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
  for (const detect of DETECTORS) {
    const result = await detect(repoPath);
    if (result !== null) return result;
  }
  return { type: 'unknown' };
}
