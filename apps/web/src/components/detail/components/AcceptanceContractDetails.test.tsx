/** @vitest-environment jsdom */
import type { AcceptanceContractDto } from '@/lib/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AcceptanceContractDetails } from './AcceptanceContractDetails';

afterEach(cleanup);

const CONTRACT: AcceptanceContractDto = {
  source: 'normalized',
  criteria: [
    {
      id: 'AC-1',
      statement: 'Lane cards are ordered newest first.',
      executableChecks: [
        {
          id: 'AC-1-check-1',
          command: 'pnpm vitest run apps/web/src/lib/lanes.config.test.ts',
          expectedExitCodes: [0],
          kind: 'unit',
        },
      ],
    },
  ],
};

describe('AcceptanceContractDetails', () => {
  it('renders a collapsed accordion header and reveals criteria after one toggle', () => {
    render(<AcceptanceContractDetails contract={CONTRACT} />);

    expect(screen.getByText('Acceptance Contract')).toBeTruthy();
    expect(screen.getByText('Normalized · 1 AC')).toBeTruthy();
    expect(screen.queryByText('Lane cards are ordered newest first.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /acceptance contract/i }));

    expect(screen.getByText('Lane cards are ordered newest first.')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run apps/web/src/lib/lanes.config.test.ts')).toBeTruthy();
  });

  it('renders criteria immediately when defaultOpen is true', () => {
    render(<AcceptanceContractDetails contract={CONTRACT} defaultOpen />);

    expect(screen.getByText('Lane cards are ordered newest first.')).toBeTruthy();
  });

  it('renders nothing without criteria', () => {
    const { container } = render(
      <AcceptanceContractDetails contract={{ source: 'issue-body', criteria: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
