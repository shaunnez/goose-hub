import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SkillConfig } from './interface.js';

export type SkillContractReport = {
  skill: string;
  allowlistTags: string[];
  promptTags: string[];
  snakeCaseTags: string[];
  missingFromPrompt: string[];
  extraPromptTags: string[];
  schemaFields: string[];
  outputSchema: OutputSchemaReport;
  outputExample: OutputExampleReport;
  pathLanguage: PathLanguageReport;
  worktreePathExposure: WorktreePathExposureReport;
  projectOverlayPaths: string[];
  consumerPaths: string[];
};

export type SkillContractAudit = {
  skills: SkillContractReport[];
};

export type OutputExampleReport = {
  status:
    | 'valid-output-example'
    | 'missing-output-example'
    | 'invalid-output-example'
    | 'no-marked-output-example'
    | 'example-not-required';
  markedExamples: number;
  parseableExamples: number;
  missingSchemaFields: string[];
  extraExampleFields: string[];
  issues: string[];
};

export type OutputSchemaReport = {
  configured: boolean;
  configuredSchema: string | null;
};

export type PathLanguageReport = {
  vagueWorkspaceRelative: string[];
  packageRelativeExamples: string[];
  packageRelativeCommandGuidance: string[];
};

export type WorktreePathExposureReport = {
  allowlist: boolean;
  promptLines: string[];
  configLines: string[];
};

function extractTags(input: string): string[] {
  const matches = input.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9_-]*)\b/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1]))).sort();
}

function extractAllowlistTags(configSource: string): string[] {
  const match = configSource.match(/contextAllowlist\s*:\s*\[([\s\S]*?)\]/m);
  if (!match) return [];
  const keys = Array.from(match[1].matchAll(/["'`]([a-zA-Z0-9_.-]+)["'`]/g), (m) => m[1]);
  return Array.from(new Set(keys.map((k) => k.split('.')[0]))).sort();
}

function extractConfiguredOutputSchema(configSource: string): string | null {
  return configSource.match(/outputSchema\s*:\s*([A-Za-z][A-Za-z0-9_]*)/)?.[1] ?? null;
}

function isSnakeCase(tag: string): boolean {
  return /_/.test(tag) && /^[a-z0-9_]+$/.test(tag);
}

function toSnakeCase(input: string): string {
  return input.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function filterContextTags(promptTags: string[], allowlistTags: string[]): string[] {
  const contextTags = new Set(['task', ...allowlistTags, ...allowlistTags.map(toSnakeCase)]);
  return promptTags.filter((tag) => contextTags.has(tag));
}

function extractJsonExamples(prompt: string): string[] {
  return Array.from(prompt.matchAll(/```json\s*([\s\S]*?)```/g), (m) => m[1].trim());
}

function extractMarkedJsonExamples(prompt: string): string[] {
  return Array.from(
    prompt.matchAll(/<!--\s*output-example\s*-->\s*```json\s*([\s\S]*?)```/g),
    (m) => m[1].trim(),
  );
}

function parseJsonObject(
  source: string,
): { value: Record<string, unknown>; fields: string[] } | null {
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { value: parsed as Record<string, unknown>, fields: Object.keys(parsed).sort() };
  } catch {
    return null;
  }
}

function lineHits(source: string, predicate: (line: string) => boolean): string[] {
  return source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0 && predicate(line))
    .map(({ line, lineNumber }) => `${lineNumber}: ${line}`);
}

function collectJsonStrings(value: unknown, strings: string[] = []): string[] {
  if (typeof value === 'string') {
    strings.push(value);
    return strings;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, strings);
    return strings;
  }
  if (value != null && typeof value === 'object') {
    for (const item of Object.values(value)) collectJsonStrings(item, strings);
  }
  return strings;
}

const PACKAGE_RELATIVE_OUTPUT_PATH = /^(?:src|e2e)\/[^/]/;
const PACKAGE_RELATIVE_COMMAND_PATH =
  /(?:^|[\s`"'])(?:src|e2e)\/[A-Za-z0-9_./{}<>-]+\.[cm]?[jt]sx?/i;
const COMMAND_CONTRACT_LINE =
  /\b(?:verificationTooling|executableChecks|verifyCommand|acceptanceCriteria|repo-root command|terminal JSON|output paths|passed forward|passed-forward|pass forward|command)\b/i;

function isProhibitivePathExample(line: string): boolean {
  const match = line.match(PACKAGE_RELATIVE_COMMAND_PATH);
  if (match?.index == null) return false;
  const beforePath = line.slice(Math.max(0, match.index - 96), match.index).toLowerCase();
  return /\b(?:do not|don't|never|avoid|forbidden|wrong|bad)\b/.test(beforePath);
}

function auditPathLanguage(prompt: string, schema: string): PathLanguageReport {
  const combined = `${prompt}\n${schema}`;
  const vagueWorkspaceRelative = lineHits(combined, (line) => {
    const lower = line.toLowerCase();
    if (!lower.includes('workspace-relative')) return false;
    return !(
      lower.includes('repo-root') ||
      lower.includes('worktree-root') ||
      lower.includes('canonical') ||
      lower.includes('mcp__factory-tools__')
    );
  });

  const packageRelativeExamples = extractJsonExamples(prompt).flatMap((example) => {
    try {
      return collectJsonStrings(JSON.parse(example)).filter((value) =>
        PACKAGE_RELATIVE_OUTPUT_PATH.test(value),
      );
    } catch {
      return [];
    }
  });
  const packageRelativeCommandGuidance = lineHits(prompt, (line) => {
    if (!COMMAND_CONTRACT_LINE.test(line)) return false;
    if (!PACKAGE_RELATIVE_COMMAND_PATH.test(line)) return false;
    return !isProhibitivePathExample(line);
  });

  return {
    vagueWorkspaceRelative,
    packageRelativeExamples: Array.from(new Set(packageRelativeExamples)).sort(),
    packageRelativeCommandGuidance,
  };
}

function mentionsModelVisibleWorktreePath(line: string): boolean {
  return /\bworktreePath\b|\bworktree[-\s]+path\b/i.test(line);
}

function auditWorktreePathExposure(prompt: string, config: string): WorktreePathExposureReport {
  const promptLines = lineHits(prompt, mentionsModelVisibleWorktreePath);
  const configLines = lineHits(config, mentionsModelVisibleWorktreePath);
  return {
    allowlist: extractAllowlistTags(config).includes('worktreePath'),
    promptLines,
    configLines,
  };
}

function shapeKeysFromSchema(schema: unknown): string[] {
  const def = getSchemaDef(schema);
  if (!def) return [];

  if (def.type === 'object') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    return shape && typeof shape === 'object' ? Object.keys(shape).sort() : [];
  }

  if (def.type === 'union') {
    const options = Array.isArray(def.options) ? def.options : [];
    return Array.from(new Set(options.flatMap(shapeKeysFromSchema))).sort();
  }

  if (def.type === 'intersection') {
    return Array.from(
      new Set([
        ...(shapeKeysFromSchema(def.left) ?? []),
        ...(shapeKeysFromSchema(def.right) ?? []),
      ]),
    ).sort();
  }

  return [];
}

function getSchemaDef(schema: unknown): Record<string, unknown> | null {
  if (!schema || typeof schema !== 'object') return null;
  const maybeSchema = schema as { def?: unknown; _def?: unknown };
  const def = maybeSchema.def ?? maybeSchema._def;
  return def && typeof def === 'object' ? (def as Record<string, unknown>) : null;
}

function summarizeValidationError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'schema validation failed';
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return 'schema validation failed';

  return issues
    .slice(0, 5)
    .map((issue) => {
      if (!issue || typeof issue !== 'object') return 'schema validation failed';
      const path = Array.isArray((issue as { path?: unknown }).path)
        ? ((issue as { path: unknown[] }).path.join('.') ?? '')
        : '';
      const message =
        typeof (issue as { message?: unknown }).message === 'string'
          ? (issue as { message: string }).message
          : 'schema validation failed';
      return path ? `${path}: ${message}` : message;
    })
    .join('; ');
}

function auditOutputExample(
  prompt: string,
  outputSchema: SkillConfig['outputSchema'],
  schemaFields: string[],
): OutputExampleReport {
  if (outputSchema == null) {
    return {
      status: 'example-not-required',
      markedExamples: 0,
      parseableExamples: 0,
      missingSchemaFields: [],
      extraExampleFields: [],
      issues: [],
    };
  }

  const allJsonExamples = extractJsonExamples(prompt);
  const markedExamples = extractMarkedJsonExamples(prompt);
  if (markedExamples.length === 0) {
    return {
      status: allJsonExamples.length === 0 ? 'missing-output-example' : 'no-marked-output-example',
      markedExamples: 0,
      parseableExamples: 0,
      missingSchemaFields: schemaFields,
      extraExampleFields: [],
      issues:
        allJsonExamples.length === 0
          ? ['prompt contains no JSON code block marked as output']
          : ['prompt contains JSON blocks, but none are preceded by <!-- output-example -->'],
    };
  }

  const schemaFieldSet = new Set(schemaFields);
  const issues: string[] = [];
  let parseableExamples = 0;
  const missingFields = new Set<string>();
  const extraFields = new Set<string>();

  for (const [index, example] of markedExamples.entries()) {
    const parsed = parseJsonObject(example);
    if (!parsed) {
      issues.push(`marked output example ${index + 1}: invalid top-level JSON object`);
      for (const field of schemaFields) missingFields.add(field);
      continue;
    }

    parseableExamples += 1;
    for (const field of schemaFields.filter((field) => !parsed.fields.includes(field))) {
      missingFields.add(field);
    }
    for (const field of parsed.fields.filter((field) => !schemaFieldSet.has(field))) {
      extraFields.add(field);
    }

    const result = outputSchema.safeParse(parsed.value);
    if (!result.success) {
      issues.push(`marked output example ${index + 1}: ${summarizeValidationError(result.error)}`);
    }
  }

  return {
    status: issues.length === 0 ? 'valid-output-example' : 'invalid-output-example',
    markedExamples: markedExamples.length,
    parseableExamples,
    missingSchemaFields: Array.from(missingFields).sort(),
    extraExampleFields: Array.from(extraFields).sort(),
    issues,
  };
}

function extractExportedNames(schemaSource: string): string[] {
  const names = Array.from(
    schemaSource.matchAll(/export (?:const|type|interface) ([A-Za-z][A-Za-z0-9_]*)/g),
    (m) => m[1],
  );
  return Array.from(new Set(names));
}

function collectConsumers(
  repoRoot: string,
  schemaPath: string,
  schemaSource: string,
  skill: string,
): string[] {
  const rel = relative(repoRoot, schemaPath).replaceAll('\\', '/');
  const roots = ['core', 'slices', 'apps/server/src/domains'];
  const consumers = new Set<string>();
  const exportedNames = extractExportedNames(schemaSource);
  const moduleHints = [
    rel,
    rel.replace(/\.ts$/, '.js'),
    `@goose-hub/skills/${skill}/schema`,
    `skills/${skill}/schema`,
  ];

  for (const root of roots) {
    const dir = join(repoRoot, root);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      for (const item of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, item.name);
        if (item.isDirectory()) {
          stack.push(full);
        } else if (item.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(item.name)) {
          const src = readFileSync(full, 'utf8');
          const importsSchema =
            moduleHints.some((hint) => src.includes(hint)) ||
            exportedNames.some((name) => src.includes(name));

          if (importsSchema) {
            consumers.add(relative(repoRoot, full).replaceAll('\\', '/'));
          }
        }
      }
    }
  }

  return Array.from(consumers).sort();
}

async function loadSkillConfig(configPath: string): Promise<SkillConfig | null> {
  if (!existsSync(configPath)) return null;
  const module = (await import(pathToFileURL(configPath).href)) as { default?: SkillConfig };
  return module.default ?? null;
}

function collectProjectOverlays(
  repoRoot: string,
  skill: string,
): Array<{ path: string; source: string }> {
  const targetProjectsDir = join(repoRoot, 'target-projects');
  if (!existsSync(targetProjectsDir)) return [];

  return readdirSync(targetProjectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(targetProjectsDir, entry.name, 'agent-context', `${skill}.md`))
    .filter((path) => existsSync(path))
    .map((path) => ({
      path: relative(repoRoot, path).replaceAll('\\', '/'),
      source: readFileSync(path, 'utf8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function auditSkillContracts(repoRoot: string): Promise<SkillContractAudit> {
  const skillsDir = join(repoRoot, 'skills');
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const reports: SkillContractReport[] = [];

  for (const skill of skills) {
    const skillDir = join(skillsDir, skill);
    const promptPath = join(skillDir, 'prompt.md');
    const configPath = join(skillDir, 'skill.config.ts');
    const schemaPath = join(skillDir, 'schema.ts');

    const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
    const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '';
    const projectOverlays = collectProjectOverlays(repoRoot, skill);
    const promptWithProjectOverlays = [
      prompt,
      ...projectOverlays.map((overlay) => `<!-- ${overlay.path} -->\n${overlay.source}`),
    ].join('\n\n');

    const allowlistTags = extractAllowlistTags(config);
    const promptTags = filterContextTags(extractTags(prompt), allowlistTags);
    const snakeCaseTags = promptTags.filter(isSnakeCase);
    const missingFromPrompt = allowlistTags.filter((t) => !promptTags.includes(t));
    const extraPromptTags = promptTags.filter((t) => t !== 'task' && !allowlistTags.includes(t));

    const skillConfig = await loadSkillConfig(configPath);
    const schemaFields = shapeKeysFromSchema(skillConfig?.outputSchema);
    const configuredOutputSchema = extractConfiguredOutputSchema(config);

    reports.push({
      skill,
      allowlistTags,
      promptTags,
      snakeCaseTags,
      missingFromPrompt,
      extraPromptTags,
      schemaFields,
      outputSchema: {
        configured: skillConfig?.outputSchema != null,
        configuredSchema: configuredOutputSchema,
      },
      outputExample: auditOutputExample(prompt, skillConfig?.outputSchema, schemaFields),
      pathLanguage: auditPathLanguage(promptWithProjectOverlays, schema),
      worktreePathExposure: auditWorktreePathExposure(promptWithProjectOverlays, config),
      projectOverlayPaths: projectOverlays.map((overlay) => overlay.path),
      consumerPaths: existsSync(schemaPath)
        ? collectConsumers(repoRoot, schemaPath, schema, skill)
        : [],
    });
  }

  return { skills: reports };
}

export function formatSkillContractAudit(audit: SkillContractAudit): string {
  return audit.skills
    .map((r) => {
      const lines = [
        `## ${r.skill}`,
        `allowlistTags: ${r.allowlistTags.join(', ') || '(none)'}`,
        `promptTags: ${r.promptTags.join(', ') || '(none)'}`,
        `snakeCaseTags: ${r.snakeCaseTags.join(', ') || '(none)'}`,
        `missingFromPrompt: ${r.missingFromPrompt.join(', ') || '(none)'}`,
        `extraPromptTags: ${r.extraPromptTags.join(', ') || '(none)'}`,
        `schemaFields: ${r.schemaFields.join(', ') || '(none)'}`,
        `outputSchema: ${
          r.outputSchema.configured
            ? (r.outputSchema.configuredSchema ?? '(configured)')
            : '(missing)'
        }`,
        `outputExample: ${r.outputExample.status}`,
        `outputExampleMarked: ${r.outputExample.markedExamples}`,
        `outputExampleParseable: ${r.outputExample.parseableExamples}`,
        `outputExampleMissingFields: ${r.outputExample.missingSchemaFields.join(', ') || '(none)'}`,
        `outputExampleExtraFields: ${r.outputExample.extraExampleFields.join(', ') || '(none)'}`,
        `outputExampleIssues: ${r.outputExample.issues.join(' | ') || '(none)'}`,
        `pathLanguageWorkspaceRelative: ${r.pathLanguage.vagueWorkspaceRelative.length}`,
        `pathLanguagePackageRelativeExamples: ${r.pathLanguage.packageRelativeExamples.join(', ') || '(none)'}`,
        `pathLanguagePackageRelativeCommandGuidance: ${r.pathLanguage.packageRelativeCommandGuidance.length}`,
        `worktreePathExposure: allowlist=${r.worktreePathExposure.allowlist} prompt=${r.worktreePathExposure.promptLines.length} config=${r.worktreePathExposure.configLines.length}`,
        `projectOverlays: ${r.projectOverlayPaths.join(', ') || '(none)'}`,
        `consumers: ${r.consumerPaths.length}`,
      ];
      for (const c of r.consumerPaths) lines.push(`- ${c}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
