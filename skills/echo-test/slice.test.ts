import { describe, expect, it } from 'vitest';
import { toJSONSchema } from 'zod';
import { EchoOutputSchema } from './schema.js';
import config, { EchoContextSchema } from './skill.config.js';

describe('echo-test schema', () => {
  it('accepts valid output with echo and decisionSummaries', () => {
    const result = EchoOutputSchema.safeParse({
      echo: 'hello',
      decisionSummaries: [{ step: 'echo', summary: 'Echoed input message' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects output missing decisionSummaries', () => {
    const result = EchoOutputSchema.safeParse({ echo: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects output with empty decisionSummaries array', () => {
    const result = EchoOutputSchema.safeParse({ echo: 'hello', decisionSummaries: [] });
    expect(result.success).toBe(false);
  });

  it('accepts evidence as optional field on DecisionSummary', () => {
    const result = EchoOutputSchema.safeParse({
      echo: 'test',
      decisionSummaries: [{ step: 's', summary: 'ok', evidence: 'some proof' }],
    });
    expect(result.success).toBe(true);
  });

  it('zod toJSONSchema roundtrip produces valid JSON Schema object', () => {
    const jsonSchema = toJSONSchema(EchoOutputSchema);
    expect(typeof jsonSchema).toBe('object');
    expect(jsonSchema).not.toBeNull();
    expect(jsonSchema).toHaveProperty('properties');
  });
});

describe('echo-test skill config', () => {
  it('has empty toolBundles (echo needs no tools)', () => {
    expect(config.toolBundles).toHaveLength(0);
  });

  it('is pinned to sonnet model', () => {
    expect(config.modelPin).toBe('sonnet');
  });

  it('does not require fresh context', () => {
    expect(config.freshContext).toBe(false);
  });

  it('context schema validates message field', () => {
    const valid = EchoContextSchema.safeParse({ message: 'hello' });
    expect(valid.success).toBe(true);

    const invalid = EchoContextSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });
});
