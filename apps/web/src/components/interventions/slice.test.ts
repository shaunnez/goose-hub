import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  decideIntervention: vi.fn(),
  fetchIssues: vi.fn(),
  fetchProjectConfigs: vi.fn(),
  fetchProjectInterventions: vi.fn(),
}));

import { describe, expect, it } from 'vitest';
import { OperatorQueuePage } from './OperatorQueuePage';

describe('interventions slice', () => {
  // Smoke test only — verifies the module exports the component.
  // If you add a render test, wrap with QueryClientProvider + MemoryRouter
  // and mock the required @/lib/api calls (see OperatorQueuePage.test.tsx for setup).
  it('exports OperatorQueuePage as a function', () => {
    expect(typeof OperatorQueuePage).toBe('function');
  });
});
