/**
 * Wizard step state machine for the bootstrap wizard (M12.07).
 *
 * Steps:
 *   1. source   — choose local project source and integrations
 *   2. preview  — show exact generated project.config.ts
 *   3. submit   — create target-projects/<slug>/project.config.ts locally
 *
 * The state machine is intentionally pure: the wizard component holds the
 * `WizardState` in `useState` and calls `next()` / `prev()` on each step.
 */

export type WizardStep = 'source' | 'preview' | 'submit';

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = ['source', 'preview', 'submit'] as const;

const STEP_LABELS: Record<WizardStep, string> = {
  source: 'Source',
  preview: 'Config',
  submit: 'Create',
};

export function stepLabel(step: WizardStep): string {
  return STEP_LABELS[step];
}

export function nextStep(current: WizardStep): WizardStep {
  const idx = WIZARD_STEPS.indexOf(current);
  if (idx < 0 || idx === WIZARD_STEPS.length - 1) return current;
  return WIZARD_STEPS[idx + 1];
}

export function prevStep(current: WizardStep): WizardStep {
  const idx = WIZARD_STEPS.indexOf(current);
  if (idx <= 0) return current;
  return WIZARD_STEPS[idx - 1];
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

const REPO_REF_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Validate the user-typed repo ref before we hit the server. */
export function isValidRepoRef(ref: string): boolean {
  return REPO_REF_PATTERN.test(ref.trim());
}

export function parseRepoRefs(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((ref) => ref.trim())
    .filter(Boolean);
}

export function isValidRepoRefs(raw: string): boolean {
  const refs = parseRepoRefs(raw);
  return refs.length > 0 && refs.every(isValidRepoRef);
}
