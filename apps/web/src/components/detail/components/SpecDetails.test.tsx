import type { EngineeringSpecDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SpecDetails } from './SpecDetails';

afterEach(cleanup);

const SPEC: EngineeringSpecDto = {
  pipelineRunId: 'pipe-test-123',
  updatedAt: '2026-05-22T10:00:00Z',
  objective: 'Build the authentication flow with token refresh.',
  architecture: {
    current: 'Auth requests refresh tokens in the route handler.',
    new: 'Move refresh validation into session middleware.',
    decisionRationale: 'Keeps route handlers thin and centralizes expiry handling.',
  },
  workPackages: [
    {
      id: 'WP1',
      filesOwned: ['src/auth/login.ts', 'src/auth/token.ts'],
      changes: 'Update login and token refresh flow.',
      dependsOn: [],
      builderTier: 'sonnet',
    },
    {
      id: 'WP2',
      filesOwned: ['src/auth/middleware.ts'],
      changes: 'Add middleware enforcement for refreshed sessions.',
      dependsOn: ['WP1'],
      builderTier: 'haiku',
    },
  ],
  executionOrder: [
    { batch: 0, wpIds: ['WP1'] },
    { batch: 1, wpIds: ['WP2'] },
  ],
  verificationTooling: [
    {
      name: 'Auth unit tests',
      command: 'pnpm vitest run src/auth/login.test.ts src/auth/middleware.test.ts',
      expectedExitCodes: [0],
      inputSpec: 'Run from repo root.',
    },
  ],
  acceptanceCriteria: [
    {
      id: 'AC-1',
      statement: 'Users can log in with a valid refresh token.',
      executableChecks: [
        {
          id: 'AC-1-check-1',
          command: 'pnpm vitest run src/auth/login.test.ts',
          expectedExitCodes: [0],
          kind: 'unit',
        },
        {
          id: 'AC-1-check-2',
          command: 'pnpm vitest run src/auth/token.test.ts',
          expectedExitCodes: [0],
          kind: 'unit',
        },
      ],
    },
    { id: 'AC-2', statement: 'Expired tokens are rejected.' },
    { id: 'AC-3', statement: 'Middleware forwards authenticated requests.' },
    { id: 'AC-4', statement: 'Refresh failures are reported.' },
    { id: 'AC-5', statement: 'No credentials are logged.' },
  ],
  acceptanceCriteriaCount: 5,
  interfaceContracts: [
    {
      name: 'validateRefreshToken',
      signature: 'export function validateRefreshToken(token: string): Promise<AuthSession>;',
      file: 'src/auth/token.ts',
      lineRange: '12-20',
    },
  ],
  schemaChanges: {
    ddl: ['ALTER TABLE sessions ADD COLUMN refreshed_at TEXT;'],
    migrations: ['migrations/20260522100000_refresh_sessions.sql'],
  },
  constraints: [
    {
      kind: 'phase',
      name: 'Investigation tab owns spec display',
      source: 'apps/web/src/components/detail/components/InvestigationSection.tsx:277',
    },
  ],
  riskRegister: [
    {
      severity: 'medium',
      risk: 'Refresh middleware could reject valid legacy sessions.',
      mitigation: 'Keep legacy fallback covered by integration tests.',
    },
  ],
};

describe('SpecDetails', () => {
  it('renders collapsed header regardless of lifecycle state', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:investigation-complete" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
    expect(screen.getByText('2 work packages · 5 AC')).toBeTruthy();
    expect(screen.queryByText('Build the authentication flow with token refresh.')).toBeNull();
  });

  it('renders collapsed header when state is factory:dev-ready', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
    expect(screen.getByText('2 work packages · 5 AC')).toBeTruthy();
    expect(screen.queryByText('Build the authentication flow with token refresh.')).toBeNull();
  });

  it('expands to show all populated engineering spec sections', async () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    await userEvent.click(screen.getByText('Engineering Spec'));
    expect(screen.getByText('Build the authentication flow with token refresh.')).toBeTruthy();
    expect(screen.getByText('Move refresh validation into session middleware.')).toBeTruthy();
    expect(screen.getAllByText('WP1').length).toBeGreaterThan(1);
    expect(screen.getAllByText('WP2').length).toBeGreaterThan(1);
    expect(screen.getByText('Update login and token refresh flow.')).toBeTruthy();
    expect(screen.getByText('Batch 0')).toBeTruthy();
    expect(screen.getByText('sonnet')).toBeTruthy();
    expect(screen.getByText('haiku')).toBeTruthy();
    expect(screen.getByText('5 acceptance criteria')).toBeTruthy();
    expect(screen.getByText('Users can log in with a valid refresh token.')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run src/auth/login.test.ts')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run src/auth/token.test.ts')).toBeTruthy();
    expect(screen.getByText('Expired tokens are rejected.')).toBeTruthy();
    expect(screen.getByText('Auth unit tests')).toBeTruthy();
    expect(
      screen.getByText('pnpm vitest run src/auth/login.test.ts src/auth/middleware.test.ts'),
    ).toBeTruthy();
    expect(screen.getByText('validateRefreshToken')).toBeTruthy();
    expect(screen.getByText('ALTER TABLE sessions ADD COLUMN refreshed_at TEXT;')).toBeTruthy();
    expect(screen.getByText('Investigation tab owns spec display')).toBeTruthy();
    expect(screen.getByText('Refresh middleware could reject valid legacy sessions.')).toBeTruthy();
    expect(screen.getByText('pipe-test-123')).toBeTruthy();
  });

  it('reveals engineering spec details after a single toggle without nested accordions', async () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);

    expect(screen.queryByText('Objective')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /engineering spec/i }));

    expect(screen.getByText('Objective')).toBeTruthy();
    expect(screen.getByText('Build the authentication flow with token refresh.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /engineering spec/i })).toHaveLength(1);
  });

  it('does not render legacy verifyCommand text for canonical criteria without executable checks', async () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    await userEvent.click(screen.getByText('Engineering Spec'));
    expect(screen.getByText('Expired tokens are rejected.')).toBeTruthy();
    expect(screen.queryByText(/verifyCommand/i)).toBeNull();
    expect(screen.queryByText(/missing/i)).toBeNull();
  });
});
