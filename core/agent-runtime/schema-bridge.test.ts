import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { skillsRoot } from '@goose-hub/skills';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AdviseOnPlanSchema } from '../../skills/advise-on-plan/schema.js';
import { ImplementSchema } from '../../skills/implement/schema.js';
import { InterventionProposerOutputSchema } from '../../skills/intervention-proposer/schema.js';
import { ReviewOutputSchema } from '../../skills/review/schema.js';
import { TriageOutputSchema } from '../../skills/triage/schema.js';
import { PRDOutputSchema } from '../../skills/write-prd/schema.js';
import { toJsonSchema } from './schema-bridge.js';

describe('toJsonSchema', () => {
  it('converts a Zod schema to JSON Schema', () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const result = toJsonSchema(schema);
    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['name', 'count'],
      additionalProperties: false,
    });
  });

  it('preserves optional object properties, marks them required, and allows null', () => {
    const schema = z.object({
      decisionSummaries: z.array(
        z.object({
          kind: z.string(),
          summary: z.string(),
          evidence: z.string().optional(),
        }),
      ),
    });

    const result = toJsonSchema(schema);
    const decisionSummaries = result.properties as Record<string, unknown>;
    const field = decisionSummaries.decisionSummaries as { items?: unknown };
    const item = field.items as { properties?: Record<string, unknown>; required?: string[] };

    expect(item.properties).toHaveProperty('evidence');
    expect(item.properties?.evidence).toEqual({ type: ['string', 'null'] });
    expect(item.required).toEqual(['kind', 'summary', 'evidence']);
  });

  it('allows null for nested optional decision summary evidence in triage output', () => {
    const result = toJsonSchema(TriageOutputSchema);
    const properties = result.properties as Record<string, unknown>;
    const decisionSummaries = properties.decisionSummaries as { items?: unknown };
    const item = decisionSummaries.items as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(item.properties?.evidence).toEqual({ type: ['string', 'null'] });
    expect(item.required).toEqual(['kind', 'summary', 'evidence']);
  });

  it('strips unsupported propertyNames keywords', () => {
    const schema = z.object({
      input: z.record(z.string(), z.unknown()),
    });

    const result = JSON.stringify(toJsonSchema(schema));

    expect(result).not.toContain('propertyNames');
  });

  it('strips uri string formats rejected by Codex response schemas', () => {
    const result = toJsonSchema(z.object({ prUrl: z.string().url() }));

    const properties = result.properties as Record<string, unknown>;
    const prUrl = properties.prUrl as Record<string, unknown>;

    expect(prUrl).toMatchObject({ type: 'string' });
    expect(prUrl).not.toHaveProperty('format');
  });

  it('replaces unconstrained schema nodes with an explicit JSON value type', () => {
    const result = toJsonSchema(z.object({ payload: z.unknown() }));

    const properties = result.properties as Record<string, unknown>;
    const payload = properties.payload as Record<string, unknown>;

    expect(payload).toEqual({
      type: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'],
    });
  });

  it('allows null through optional enum schemas', () => {
    const result = toJsonSchema(z.object({ priority: z.enum(['p1', 'p2']).optional() }));
    const properties = result.properties as Record<string, unknown>;

    expect(properties.priority).toEqual({
      type: ['string', 'null'],
      enum: ['p1', 'p2', null],
    });
    expect(result.required).toEqual(['priority']);
  });

  it('keeps implement output schema acceptable for Codex response schemas', () => {
    const result = JSON.stringify(toJsonSchema(ImplementSchema));

    expect(result).not.toContain('"format":"uri"');
    expect(result).not.toContain('"format": "uri"');
  });

  it('preserves optional PRD output fields needed by write-prd validation', () => {
    const result = toJsonSchema(PRDOutputSchema);
    const properties = result.properties as Record<string, unknown>;

    const acceptanceCriteria = properties.acceptanceCriteria as { items?: unknown };
    const acceptanceCriterion = acceptanceCriteria.items as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };

    expect(Object.keys(acceptanceCriterion.properties ?? {})).toEqual([
      'id',
      'statement',
      'journeyId',
      'stepIdx',
      'crossCutting',
      'verifyCommand',
    ]);
    expect(acceptanceCriterion.properties?.journeyId).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.properties?.stepIdx).toMatchObject({ type: ['integer', 'null'] });
    expect(acceptanceCriterion.properties?.crossCutting).toEqual({ type: ['boolean', 'null'] });
    expect(acceptanceCriterion.properties?.verifyCommand).toEqual({ type: ['string', 'null'] });
    expect(acceptanceCriterion.required).toEqual([
      'id',
      'statement',
      'journeyId',
      'stepIdx',
      'crossCutting',
      'verifyCommand',
    ]);
    expect(acceptanceCriterion.additionalProperties).toBe(false);

    const implementationDecisions = properties.implementationDecisions as { items?: unknown };
    const implementationDecision = implementationDecisions.items as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(implementationDecision.properties).toHaveProperty('rationale');
    expect(implementationDecision.properties).toHaveProperty('moduleRef');
    expect(implementationDecision.properties?.rationale).toEqual({ type: ['string', 'null'] });
    expect(implementationDecision.properties?.moduleRef).toEqual({ type: ['string', 'null'] });
    expect(implementationDecision.required).toEqual(['decision', 'rationale', 'moduleRef']);

    const testingDecisions = properties.testingDecisions as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    expect(testingDecisions.properties).toHaveProperty('priorArt');
    expect(testingDecisions.properties?.priorArt).toEqual({ type: ['string', 'null'] });
    expect(testingDecisions.required).toEqual(['approach', 'modulesToTest', 'priorArt']);
  });

  it('keeps intervention proposer output schema acceptable for Codex response schemas', () => {
    const result = toJsonSchema(InterventionProposerOutputSchema);
    const properties = result.properties as Record<string, unknown>;
    const options = properties.options as { items?: unknown };
    const item = options.items as { properties?: Record<string, unknown> };
    const payload = item.properties?.payload as { anyOf?: unknown[] };

    expect(payload.anyOf?.length).toBeGreaterThan(0);
    for (const variant of payload.anyOf ?? []) {
      expect(variant).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(JSON.stringify(result)).not.toContain('"payload":{}');
  });

  it('keeps review escalationReason visible in the Codex response schema', () => {
    const result = toJsonSchema(ReviewOutputSchema);

    expect(result.type).toBe('object');
    expect(result).not.toHaveProperty('oneOf');
    expect(result).toMatchObject({
      properties: {
        verdict: { type: 'string', enum: ['approved', 'needs-fix', 'needs-human'] },
        confidence: { type: 'number' },
        criteriaChecks: { type: 'array' },
        findings: { type: 'array' },
        decisionSummaries: { type: 'array' },
      },
      required: [
        'verdict',
        'confidence',
        'criteriaChecks',
        'findings',
        'decisionSummaries',
        'escalationReason',
      ],
      additionalProperties: false,
    });
    const properties = result.properties as Record<string, unknown>;
    expect(schemaAllowsNull(properties.escalationReason)).toBe(true);
  });

  it('keeps advise-on-plan top-level schema composition-free for Codex', () => {
    const result = toJsonSchema(AdviseOnPlanSchema);

    expect(result.type).toBe('object');
    expect(result).not.toHaveProperty('oneOf');
    expect(result).not.toHaveProperty('anyOf');
    expect(result).not.toHaveProperty('allOf');
    expect(result).toMatchObject({
      properties: {
        verdict: { type: 'string', enum: ['proceed', 'revise', 'abort'] },
      },
      required: ['verdict', 'confidence', 'feedback', 'reason', 'decisionSummaries'],
      additionalProperties: false,
    });
    const properties = result.properties as Record<string, unknown>;
    expect(schemaAllowsNull(properties.feedback)).toBe(true);
    expect(schemaAllowsNull(properties.reason)).toBe(true);
  });

  it('keeps active skill output schemas strict enough for Codex response schemas', async () => {
    const configs = await loadActiveSkillConfigs();

    const issues = configs.flatMap(({ skillName, outputSchema }) => {
      if (outputSchema == null) return [];
      return assertCodexCompatibleSchema(skillName, toJsonSchema(outputSchema));
    });

    expect(issues).toEqual([]);
  });

  it('returns an empty schema and warns when conversion throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A schema-shaped object that intentionally trips toJSONSchema by missing
    // the internal _zod metadata it relies on.
    const broken = {} as unknown as Parameters<typeof toJsonSchema>[0];

    const result = toJsonSchema(broken);

    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('schema-bridge');

    warnSpy.mockRestore();
  });
});

async function loadActiveSkillConfigs(): Promise<
  Array<{ skillName: string; outputSchema?: z.ZodType }>
> {
  const skillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const configs: Array<{ skillName: string; outputSchema?: z.ZodType }> = [];
  for (const skillName of skillNames) {
    const configPath = join(skillsRoot, skillName, 'skill.config.ts');
    const mod = (await import(pathToFileURL(configPath).href)) as {
      default?: { outputSchema?: unknown };
    };
    configs.push({
      skillName,
      outputSchema: mod.default?.outputSchema as z.ZodType | undefined,
    });
  }
  return configs;
}

function assertCodexCompatibleSchema(skillName: string, schema: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if ('oneOf' in schema) issues.push(`${skillName}: top-level oneOf is not allowed`);
  if ('anyOf' in schema) issues.push(`${skillName}: top-level anyOf is not allowed`);
  if ('allOf' in schema) issues.push(`${skillName}: top-level allOf is not allowed`);
  visitSchema(skillName, schema, skillName, issues);
  return issues;
}

function visitSchema(skillName: string, node: unknown, path: string, issues: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => visitSchema(skillName, child, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(node)) return;

  if ('propertyNames' in node) issues.push(`${path}: propertyNames is not allowed`);
  if (node.format === 'uri') issues.push(`${path}: format uri is not allowed`);

  if (isObjectSchema(node)) {
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required)
      ? node.required.filter((key): key is string => typeof key === 'string')
      : [];
    const propertyKeys = Object.keys(properties);
    const missingRequired = propertyKeys.filter((key) => !required.includes(key));
    if (missingRequired.length > 0) {
      issues.push(`${path}: properties missing from required: ${missingRequired.join(', ')}`);
    }
    if (node.additionalProperties !== false) {
      issues.push(`${path}: additionalProperties must be false`);
    }
  }

  for (const [key, child] of Object.entries(node)) {
    visitSchema(skillName, child, `${path}.${key}`, issues);
  }
}

function isObjectSchema(node: Record<string, unknown>): boolean {
  return node.type === 'object' || isRecord(node.properties) || node.additionalProperties != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function schemaAllowsNull(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'null') return true;
  if (Array.isArray(value.type) && value.type.includes('null')) return true;
  const variants = Array.isArray(value.anyOf)
    ? value.anyOf
    : Array.isArray(value.oneOf)
      ? value.oneOf
      : [];
  return variants.some(schemaAllowsNull);
}
