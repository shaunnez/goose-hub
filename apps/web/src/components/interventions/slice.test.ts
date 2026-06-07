import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  decideIntervention: vi.fn(),
  fetchIssues: vi.fn(),
  fetchProjectConfigs: vi.fn(),
  fetchProjectInterventions: vi.fn(),
}));

import { OperatorQueuePage } from './OperatorQueuePage';
import { describe, it, expect } from 'vitest';

describe('interventions slice', () => {
  it('exports OperatorQueuePage as a function', () => {
    expect(typeof OperatorQueuePage).toBe('function');
  });
});
