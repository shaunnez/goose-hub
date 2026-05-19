import { describe, expect, it } from 'vitest';
import pipelineConfig from './playwright-e2e-pipeline.config.js';

describe('playwright-e2e-pipeline config', () => {
  it('includes issue specs alongside the pipeline regression suite', () => {
    expect(pipelineConfig.testDir).toBe('./e2e');
    expect(pipelineConfig.testMatch).toEqual(['pipeline/**/*.spec.ts', 'issue-*.spec.ts']);
  });

  it('keeps the sandbox-safe pipeline exclusions', () => {
    expect(pipelineConfig.testIgnore).toContain('**/state-flow.spec.ts');
  });
});
