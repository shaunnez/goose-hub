import type { EngineeringSpecDto } from '@/lib/types';
/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SpecDetails } from './SpecDetails';

afterEach(cleanup);

const SPEC: EngineeringSpecDto = {
  pipelineRunId: 'pipe-test-123',
  objective: 'Build the authentication flow with token refresh.',
  workPackages: [
    { id: 'WP1', filesOwned: ['src/auth/login.ts', 'src/auth/token.ts'], builderTier: 'sonnet' },
    { id: 'WP2', filesOwned: ['src/auth/middleware.ts'], builderTier: 'haiku' },
  ],
  acceptanceCriteria: [
    {
      id: 'AC-1',
      statement: 'Users can log in with a valid refresh token.',
      verifyCommand: 'pnpm vitest run src/auth/login.test.ts',
    },
    { id: 'AC-2', statement: 'Expired tokens are rejected.' },
    { id: 'AC-3', statement: 'Middleware forwards authenticated requests.' },
    { id: 'AC-4', statement: 'Refresh failures are reported.' },
    { id: 'AC-5', statement: 'No credentials are logged.' },
  ],
  acceptanceCriteriaCount: 5,
};

describe('SpecDetails', () => {
  it('renders nothing when itemState is before dev-ready', () => {
    const { container } = render(
      <SpecDetails spec={SPEC} itemState="factory:investigation-complete" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders collapsed header when state is factory:dev-ready', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
    expect(screen.getByText('2 work packages · 5 AC')).toBeTruthy();
    expect(screen.queryByText('Build the authentication flow with token refresh.')).toBeNull();
  });

  it('expands to show objective, work packages table, and AC count on click', async () => {
    render(<SpecDetails spec={SPEC} itemState="factory:dev-ready" />);
    await userEvent.click(screen.getByText('Engineering Spec'));
    expect(screen.getByText('Build the authentication flow with token refresh.')).toBeTruthy();
    expect(screen.getByText('WP1')).toBeTruthy();
    expect(screen.getByText('WP2')).toBeTruthy();
    expect(screen.getByText('sonnet')).toBeTruthy();
    expect(screen.getByText('haiku')).toBeTruthy();
    expect(screen.getByText('5 acceptance criteria')).toBeTruthy();
    expect(screen.getByText('Users can log in with a valid refresh token.')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run src/auth/login.test.ts')).toBeTruthy();
  });

  it('renders when state is factory:in-progress', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:in-progress" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
  });

  it('renders when state is factory:spec-ready', () => {
    render(<SpecDetails spec={SPEC} itemState="factory:spec-ready" />);
    expect(screen.getByText('Engineering Spec')).toBeTruthy();
  });
});
