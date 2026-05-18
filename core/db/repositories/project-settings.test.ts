import { describe, expect, it } from 'vitest';
import {
  type ProjectSettingsRow,
  deriveQaE2eMode,
  deriveUseInvestigationSwarm,
  deriveUseMultiAgentPipeline,
} from './project-settings.js';

function makeProjectSettingsRow(overrides: Partial<ProjectSettingsRow> = {}): ProjectSettingsRow {
  return {
    projectId: 'p1',
    perWorkflowMaxUsd: null,
    perAgentMaxUsd: null,
    perAdvisorMaxUsd: null,
    dailyTokens: null,
    maxParallelAgents: null,
    maxScoutAgents: null,
    maxRetries: null,
    perBashCommandMaxSeconds: null,
    useMultiAgentPipeline: null,
    useInvestigationSwarm: null,
    qaE2eMode: null,
    playwrightReproEnabled: null,
    evidencePostEnabled: null,
    recordDecisionTool: null,
    updatedAt: 'now',
    updatedBy: null,
    ...overrides,
  };
}

describe('deriveUseMultiAgentPipeline', () => {
  it('returns false when row is null', () => {
    expect(deriveUseMultiAgentPipeline(null)).toBe(false);
  });

  it('returns false when column is null on existing row', () => {
    expect(deriveUseMultiAgentPipeline(makeProjectSettingsRow())).toBe(false);
  });

  it('returns false when column is 0', () => {
    expect(deriveUseMultiAgentPipeline(makeProjectSettingsRow({ useMultiAgentPipeline: 0 }))).toBe(
      false,
    );
  });

  it('returns true when column is 1', () => {
    expect(deriveUseMultiAgentPipeline(makeProjectSettingsRow({ useMultiAgentPipeline: 1 }))).toBe(
      true,
    );
  });
});

describe('deriveQaE2eMode', () => {
  it('returns the config default when row is null or unset', () => {
    expect(deriveQaE2eMode(null, 'ui-changed')).toBe('ui-changed');
    expect(deriveQaE2eMode(makeProjectSettingsRow(), 'always')).toBe('always');
  });

  it('returns a valid DB override', () => {
    expect(deriveQaE2eMode(makeProjectSettingsRow({ qaE2eMode: 'off' }), 'always')).toBe('off');
  });
});

describe('deriveUseInvestigationSwarm', () => {
  it('defaults to true when row is null', () => {
    expect(deriveUseInvestigationSwarm(null)).toBe(true);
  });

  it('uses the config default when the column is null', () => {
    expect(deriveUseInvestigationSwarm(makeProjectSettingsRow(), false)).toBe(false);
  });

  it('returns false when column is 0', () => {
    expect(deriveUseInvestigationSwarm(makeProjectSettingsRow({ useInvestigationSwarm: 0 }))).toBe(
      false,
    );
  });

  it('returns true when column is 1', () => {
    expect(
      deriveUseInvestigationSwarm(makeProjectSettingsRow({ useInvestigationSwarm: 1 }), false),
    ).toBe(true);
  });
});
