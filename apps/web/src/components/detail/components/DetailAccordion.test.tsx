/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DetailAccordion } from './DetailAccordion';

afterEach(cleanup);

describe('DetailAccordion', () => {
  it('renders collapsed by default', () => {
    render(
      <DetailAccordion title="Engineering Spec" summary="2 work packages · 5 AC">
        <div>Accordion content</div>
      </DetailAccordion>,
    );

    expect(
      screen.getByRole('button', { name: /engineering spec/i }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByText('Accordion content')).toBeNull();
  });

  it('renders expanded when defaultOpen is true', () => {
    render(
      <DetailAccordion title="Findings" defaultOpen>
        <div>Expanded content</div>
      </DetailAccordion>,
    );

    expect(screen.getByRole('button', { name: /findings/i }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByText('Expanded content')).toBeTruthy();
  });

  it('keeps title and summary visible while collapsed', () => {
    render(
      <DetailAccordion title="Acceptance Contract" summary="Normalized · 1 AC">
        <div>Hidden content</div>
      </DetailAccordion>,
    );

    expect(screen.getByText('Acceptance Contract')).toBeTruthy();
    expect(screen.getByText('Normalized · 1 AC')).toBeTruthy();
    expect(screen.queryByText('Hidden content')).toBeNull();
  });

  it('toggles content visibility from the header button', async () => {
    render(
      <DetailAccordion
        title="Open Questions"
        testId="open-questions-accordion"
        contentTestId="open-questions-content"
      >
        <div>Does this affect mobile?</div>
      </DetailAccordion>,
    );

    const button = screen.getByRole('button', { name: /open questions/i });

    await userEvent.click(button);
    expect(screen.getByTestId('open-questions-accordion')).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('open-questions-content')).toBeTruthy();
    expect(screen.getByText('Does this affect mobile?')).toBeTruthy();

    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('open-questions-content')).toBeNull();
  });
});
