/** @vitest-environment jsdom */
import type { AcceptanceContractDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AcceptanceContractDetails } from './AcceptanceContractDetails';

afterEach(cleanup);

const CONTRACT: AcceptanceContractDto = {
  source: 'normalized',
  criteria: [
    {
      id: 'AC-1',
      statement: 'Lane cards are ordered newest first.',
      verifyCommand: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
    },
  ],
};

describe('AcceptanceContractDetails', () => {
  it('renders the resolved contract source and criteria', () => {
    render(<AcceptanceContractDetails contract={CONTRACT} />);

    expect(screen.getByText('Acceptance Contract')).toBeTruthy();
    expect(screen.getByText('Normalized · 1 AC')).toBeTruthy();
    expect(screen.getByText('Lane cards are ordered newest first.')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run apps/web/src/lib/lanes.config.test.ts')).toBeTruthy();
  });

  it('renders nothing without criteria', () => {
    const { container } = render(
      <AcceptanceContractDetails contract={{ source: 'issue-body', criteria: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
