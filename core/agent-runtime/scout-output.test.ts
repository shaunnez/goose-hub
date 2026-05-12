import { describe, expect, it } from 'vitest';
import { ScoutOutputSchema } from './scout-output.js';

describe('ScoutOutputSchema', () => {
  it('coerces an unknown decisionSummaries kind to UNKNOWN', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 'HALLUCINATED_KIND', summary: 'did a thing' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('UNKNOWN');
    }
  });

  it('accepts a valid kind without coercion', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 'READ', summary: 'scanned the file' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('READ');
    }
  });

  it('coerces a non-string kind to UNKNOWN', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [],
      decisionSummaries: [{ kind: 42, summary: 'oops' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisionSummaries[0]?.kind).toBe('UNKNOWN');
    }
  });

  it('treats null finding line as omitted', () => {
    const result = ScoutOutputSchema.safeParse({
      findings: [
        {
          file: 'open-questions',
          line: null,
          fact: 'OPEN_QUESTION: unclear',
          confidence: 'low',
        },
      ],
      decisionSummaries: [{ kind: 'INSIGHT', summary: 'captured open question' }],
      status: 'ok',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.findings[0]?.line).toBeUndefined();
      expect(JSON.stringify(result.data.findings[0])).not.toContain('line');
    }
  });
});
