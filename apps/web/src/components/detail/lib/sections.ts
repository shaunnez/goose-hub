// 11-section left rail keys for the full-takeover detail page.
// Order and keys come from the Harness 2.1 design; M2 only lights up
// `overview` and `timeline`. Other sections render a DeferredSurface stub.

export interface DetailSection {
  key: string;
  label: string;
  available: boolean;
  milestone?: string;
  description?: string;
}

export const SECTIONS: readonly DetailSection[] = [
  { key: 'overview', label: 'Overview', available: true },
  {
    key: 'repo',
    label: 'Triage',
    available: true,
  },
  {
    key: 'investigation',
    label: 'Investigation',
    available: true,
  },
  {
    key: 'grill',
    label: 'Grill',
    available: true,
    description: 'Discover-lane chat between you and the griller agent.',
  },
  {
    key: 'prd',
    label: 'PRD',
    available: true,
    description: 'Grilled scope, acceptance criteria, decomposition into vertical slices.',
  },

  {
    key: 'code',
    label: 'Code',
    available: true,
    description:
      'Playwright captures: screenshots, video, and console errors for bug reproduction.',
  },
  {
    key: 'qa',
    label: 'QA',
    available: true,
    description: 'Holdout QA report — outcome assessed against the original issue.',
  },
  {
    key: 'review',
    label: 'Review',
    available: true,
    description: 'Holdout review verdict, requested changes.',
  },
  {
    key: 'retrospective',
    label: 'Retrospective',
    available: true,
    description: 'Post-merge learning loop — light or deep retrospective output.',
  },
  { key: 'timeline', label: 'Timeline', available: true },
  {
    key: 'costs',
    label: 'Costs',
    available: true,
    description: 'Per-agent token spend, per-run cost, daily budget burn.',
  },
] as const;
