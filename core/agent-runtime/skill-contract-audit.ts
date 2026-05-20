import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export type SkillContractReport = {
  skill: string;
  allowlistTags: string[];
  promptTags: string[];
  snakeCaseTags: string[];
  missingFromPrompt: string[];
  extraPromptTags: string[];
  schemaFields: string[];
  outputExample: OutputExampleReport;
  pathLanguage: PathLanguageReport;
  worktreePathExposure: WorktreePathExposureReport;
  consumerPaths: string[];
};

export type SkillContractAudit = {
  skills: SkillContractReport[];
};

export type OutputExampleReport = {
  status:
    | 'matches-schema-fields'
    | 'field-drift'
    | 'no-schema-fields'
    | 'no-json-example'
    | 'no-parseable-json-example';
  parseableExamples: number;
  missingSchemaFields: string[];
  extraExampleFields: string[];
};

export type PathLanguageReport = {
  vagueWorkspaceRelative: string[];
  packageRelativeExamples: string[];
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

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function topLevelObjectFields(objectBody: string): string[] {
  const fields = new Set<string>();
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let tokenStart = 0;

  for (let i = 0; i < objectBody.length; i += 1) {
    const char = objectBody[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth -= 1;

    if ((char === '\n' || char === ',') && depth === 0) {
      const token = objectBody.slice(tokenStart, i).trim();
      const field = token.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:/)?.[1];
      if (field) fields.add(field);
      tokenStart = i + 1;
    }
  }

  const finalToken = objectBody.slice(tokenStart).trim();
  const finalField = finalToken.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:/)?.[1];
  if (finalField) fields.add(finalField);

  return Array.from(fields);
}

function extractFieldsFromFirstObjectExpression(source: string, startIndex: number): string[] {
  const objectCallIndex = source.indexOf('z.object', startIndex);
  if (objectCallIndex === -1) return [];

  const openBraceIndex = source.indexOf('{', objectCallIndex);
  if (openBraceIndex === -1) return [];

  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  if (closeBraceIndex === -1) return [];

  return topLevelObjectFields(source.slice(openBraceIndex + 1, closeBraceIndex)).sort();
}

function extractSchemaFields(schemaSource: string, configSource: string): string[] {
  const configuredSchema = configSource.match(/outputSchema\s*:\s*([A-Za-z][A-Za-z0-9_]*)/)?.[1];
  const exportedSchemas = Array.from(
    schemaSource.matchAll(/export const ([A-Za-z][A-Za-z0-9_]*Schema)\s*=/g),
    (m) => ({ name: m[1], index: m.index ?? 0 }),
  );

  const preferred =
    exportedSchemas.find((schema) => schema.name === configuredSchema) ??
    exportedSchemas.find((schema) => schema.name.endsWith('OutputSchema')) ??
    exportedSchemas.at(-1);

  if (!preferred) return [];

  return extractFieldsFromFirstObjectExpression(schemaSource, preferred.index);
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

function parseTopLevelObjectFields(source: string): string[] | null {
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.keys(parsed).sort();
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
      return collectJsonStrings(JSON.parse(example)).filter((value) => /^src\/[^/]/.test(value));
    } catch {
      return [];
    }
  });

  return {
    vagueWorkspaceRelative,
    packageRelativeExamples: Array.from(new Set(packageRelativeExamples)).sort(),
  };
}

function auditWorktreePathExposure(prompt: string, config: string): WorktreePathExposureReport {
  const promptLines = lineHits(prompt, (line) => line.includes('worktreePath'));
  const configLines = lineHits(config, (line) => line.includes('worktreePath'));
  return {
    allowlist: extractAllowlistTags(config).includes('worktreePath'),
    promptLines,
    configLines,
  };
}

function auditOutputExample(prompt: string, schemaFields: string[]): OutputExampleReport {
  if (schemaFields.length === 0) {
    return {
      status: 'no-schema-fields',
      parseableExamples: 0,
      missingSchemaFields: [],
      extraExampleFields: [],
    };
  }

  const examples = extractJsonExamples(prompt);
  if (examples.length === 0) {
    return {
      status: 'no-json-example',
      parseableExamples: 0,
      missingSchemaFields: schemaFields,
      extraExampleFields: [],
    };
  }

  const parseable = examples
    .map(parseTopLevelObjectFields)
    .filter((fields): fields is string[] => fields !== null);

  if (parseable.length === 0) {
    return {
      status: 'no-parseable-json-example',
      parseableExamples: 0,
      missingSchemaFields: schemaFields,
      extraExampleFields: [],
    };
  }

  const schemaFieldSet = new Set(schemaFields);
  const candidates = parseable
    .map((fields) => ({
      fields,
      missing: schemaFields.filter((field) => !fields.includes(field)),
      extra: fields.filter((field) => !schemaFieldSet.has(field)),
    }))
    .sort((a, b) => a.missing.length + a.extra.length - (b.missing.length + b.extra.length));

  const best = candidates[0];

  return {
    status:
      best.missing.length === 0 && best.extra.length === 0
        ? 'matches-schema-fields'
        : 'field-drift',
    parseableExamples: parseable.length,
    missingSchemaFields: best.missing,
    extraExampleFields: best.extra,
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

export function auditSkillContracts(repoRoot: string): SkillContractAudit {
  const skillsDir = join(repoRoot, 'skills');
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const reports: SkillContractReport[] = skills.map((skill) => {
    const skillDir = join(skillsDir, skill);
    const promptPath = join(skillDir, 'prompt.md');
    const configPath = join(skillDir, 'skill.config.ts');
    const schemaPath = join(skillDir, 'schema.ts');

    const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : '';
    const config = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const schema = existsSync(schemaPath) ? readFileSync(schemaPath, 'utf8') : '';

    const allowlistTags = extractAllowlistTags(config);
    const promptTags = filterContextTags(extractTags(prompt), allowlistTags);
    const snakeCaseTags = promptTags.filter(isSnakeCase);
    const missingFromPrompt = allowlistTags.filter((t) => !promptTags.includes(t));
    const extraPromptTags = promptTags.filter((t) => t !== 'task' && !allowlistTags.includes(t));

    const schemaFields = extractSchemaFields(schema, config);

    return {
      skill,
      allowlistTags,
      promptTags,
      snakeCaseTags,
      missingFromPrompt,
      extraPromptTags,
      schemaFields,
      outputExample: auditOutputExample(prompt, schemaFields),
      pathLanguage: auditPathLanguage(prompt, schema),
      worktreePathExposure: auditWorktreePathExposure(prompt, config),
      consumerPaths: existsSync(schemaPath)
        ? collectConsumers(repoRoot, schemaPath, schema, skill)
        : [],
    };
  });

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
        `outputExample: ${r.outputExample.status}`,
        `outputExampleParseable: ${r.outputExample.parseableExamples}`,
        `outputExampleMissingFields: ${r.outputExample.missingSchemaFields.join(', ') || '(none)'}`,
        `outputExampleExtraFields: ${r.outputExample.extraExampleFields.join(', ') || '(none)'}`,
        `pathLanguageWorkspaceRelative: ${r.pathLanguage.vagueWorkspaceRelative.length}`,
        `pathLanguagePackageRelativeExamples: ${r.pathLanguage.packageRelativeExamples.join(', ') || '(none)'}`,
        `worktreePathExposure: allowlist=${r.worktreePathExposure.allowlist} prompt=${r.worktreePathExposure.promptLines.length} config=${r.worktreePathExposure.configLines.length}`,
        `consumers: ${r.consumerPaths.length}`,
      ];
      for (const c of r.consumerPaths) lines.push(`- ${c}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
