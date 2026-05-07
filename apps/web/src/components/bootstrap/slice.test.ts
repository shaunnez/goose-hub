import { describe, expect, it } from 'vitest';
import {
  WIZARD_STEPS,
  isValidRepoRef,
  nextStep,
  prevStep,
  stepIndex,
  stepLabel,
} from './lib/wizard-state';

// ---------------------------------------------------------------------------
// Slice contract tests for the bootstrap wizard (M12.07, issue #308).
//
// The wizard's behaviour is split between:
//  - lib/wizard-state.ts — pure step machine + repoRef validation (here).
//  - components/BootstrapWizard.tsx — DOM rendering (covered in
//    components/BootstrapWizard.test.tsx using @testing-library/react).
// ---------------------------------------------------------------------------

describe('wizard-state — WIZARD_STEPS', () => {
  it('lists all 6 steps in order', () => {
    expect(WIZARD_STEPS).toEqual(['repo', 'stack', 'claudeMd', 'labels', 'webhook', 'submit']);
  });

  it('has a label for every step', () => {
    for (const step of WIZARD_STEPS) {
      expect(stepLabel(step)).toBeTruthy();
    }
  });

  it('returns a stable index per step', () => {
    expect(stepIndex('repo')).toBe(0);
    expect(stepIndex('submit')).toBe(WIZARD_STEPS.length - 1);
  });
});

describe('wizard-state — nextStep / prevStep', () => {
  it('advances repo → stack → claudeMd → labels → webhook → submit', () => {
    expect(nextStep('repo')).toBe('stack');
    expect(nextStep('stack')).toBe('claudeMd');
    expect(nextStep('claudeMd')).toBe('labels');
    expect(nextStep('labels')).toBe('webhook');
    expect(nextStep('webhook')).toBe('submit');
  });

  it('clamps at the final step', () => {
    expect(nextStep('submit')).toBe('submit');
  });

  it('walks back submit → webhook → … → repo', () => {
    expect(prevStep('submit')).toBe('webhook');
    expect(prevStep('webhook')).toBe('labels');
    expect(prevStep('labels')).toBe('claudeMd');
    expect(prevStep('claudeMd')).toBe('stack');
    expect(prevStep('stack')).toBe('repo');
  });

  it('clamps at the first step', () => {
    expect(prevStep('repo')).toBe('repo');
  });
});

describe('wizard-state — isValidRepoRef', () => {
  it('accepts canonical owner/repo refs', () => {
    expect(isValidRepoRef('octo/widgets')).toBe(true);
    expect(isValidRepoRef('shaunnez/goose-hub')).toBe(true);
    expect(isValidRepoRef('user-1/repo.name')).toBe(true);
    expect(isValidRepoRef('user_1/repo_name')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidRepoRef('  octo/widgets  ')).toBe(true);
  });

  it('rejects refs missing the slash', () => {
    expect(isValidRepoRef('widgets')).toBe(false);
  });

  it('rejects refs with multiple slashes', () => {
    expect(isValidRepoRef('octo/widgets/extra')).toBe(false);
  });

  it('rejects empty owner or repo halves', () => {
    expect(isValidRepoRef('/widgets')).toBe(false);
    expect(isValidRepoRef('octo/')).toBe(false);
    expect(isValidRepoRef('/')).toBe(false);
  });

  it('rejects refs with disallowed characters', () => {
    expect(isValidRepoRef('octo/widgets!')).toBe(false);
    expect(isValidRepoRef('octo widgets/x')).toBe(false);
  });
});

describe('wizard slice — public surface', () => {
  it('exports BootstrapWizard component', async () => {
    const mod = await import('./components/BootstrapWizard');
    expect(typeof mod.BootstrapWizard).toBe('function');
  });
});
