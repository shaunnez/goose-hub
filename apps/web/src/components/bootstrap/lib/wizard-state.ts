/**
 * Wizard step state machine for the bootstrap wizard (M12.07).
 *
 * Steps:
 *   1. repo        — enter `owner/repo`, server validates accessibility
 *   2. stack       — show detected stack summary, user reviews
 *   3. claudeMd    — show CLAUDE.md preview/diff (read-only), user confirms
 *   4. labels      — show labels-to-install list, user confirms
 *   5. webhook     — show webhook setup instructions, user confirms
 *   6. submit      — show "Open Registration PR" button + final result
 *
 * The state machine is intentionally pure: the wizard component holds the
 * `WizardState` in `useState` and calls `next()` / `prev()` on each step.
 */

export type WizardStep = 'repo' | 'stack' | 'claudeMd' | 'labels' | 'webhook' | 'submit';

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
  'repo',
  'stack',
  'claudeMd',
  'labels',
  'webhook',
  'submit',
] as const;

const STEP_LABELS: Record<WizardStep, string> = {
  repo: 'Repository',
  stack: 'Stack',
  claudeMd: 'CLAUDE.md',
  labels: 'Labels',
  webhook: 'Webhook',
  submit: 'Open PR',
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
