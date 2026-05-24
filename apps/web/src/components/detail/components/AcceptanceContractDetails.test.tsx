/** @vitest-environment jsdom */
import type { AcceptanceContractDto } from '@/lib/types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('renders a collapsed accordion header by default', () => {
    render(<AcceptanceContractDetails contract={CONTRACT} />);

    const toggle = screen.getByRole('button', { name: /acceptance contract/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Normalized · 1 AC')).toBeTruthy();
    expect(screen.queryByText('Lane cards are ordered newest first.')).toBeNull();
  });

  it('toggles the acceptance criteria body without losing content', async () => {
    const user = userEvent.setup();
    render(<AcceptanceContractDetails contract={CONTRACT} />);

    const toggle = screen.getByRole('button', { name: /acceptance contract/i });
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Lane cards are ordered newest first.')).toBeTruthy();
    expect(screen.getByText('pnpm vitest run apps/web/src/lib/lanes.config.test.ts')).toBeTruthy();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Lane cards are ordered newest first.')).toBeNull();
  });

  it('renders nothing without criteria', () => {
    const { container } = render(
      <AcceptanceContractDetails contract={{ source: 'issue-body', criteria: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
