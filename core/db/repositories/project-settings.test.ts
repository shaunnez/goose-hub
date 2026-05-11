import { describe, expect, it } from 'vitest';
import { deriveUseMultiAgentPipeline } from './project-settings.js';

describe('deriveUseMultiAgentPipeline', () => {
  it('returns false when row is null', () => {
    expect(deriveUseMultiAgentPipeline(null)).toBe(false);
  });

  it('returns false when column is null on existing row', () => {
    expect(
      deriveUseMultiAgentPipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useMultiAgentPipeline: null,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(false);
  });

  it('returns false when column is 0', () => {
    expect(
      deriveUseMultiAgentPipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useMultiAgentPipeline: 0,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(false);
  });

  it('returns true when column is 1', () => {
    expect(
      deriveUseMultiAgentPipeline({
        projectId: 'p1',
        perWorkflowMaxUsd: null,
        perAgentMaxUsd: null,
        perAdvisorMaxUsd: null,
        dailyTokens: null,
        maxParallelAgents: null,
        maxRetries: null,
        perBashCommandMaxSeconds: null,
        useMultiAgentPipeline: 1,
        recordDecisionTool: null,
        updatedAt: 'now',
        updatedBy: null,
      }),
    ).toBe(true);
  });
});
