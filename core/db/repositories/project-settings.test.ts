import { describe, expect, it } from 'vitest';
import { deriveUseM19Pipeline } from './project-settings.js';

describe('deriveUseM19Pipeline', () => {
  it('returns false when row is null', () => {
    expect(deriveUseM19Pipeline(null)).toBe(false);
  });

  it('returns false when column is null on existing row', () => {
    expect(
      deriveUseM19Pipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useM19Pipeline: null,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(false);
  });

  it('returns false when column is 0', () => {
    expect(
      deriveUseM19Pipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useM19Pipeline: 0,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(false);
  });

  it('returns true when column is 1', () => {
    expect(
      deriveUseM19Pipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useM19Pipeline: 1,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(true);
  });
});
