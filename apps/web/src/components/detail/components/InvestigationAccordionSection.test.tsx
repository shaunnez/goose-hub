/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlaskConical } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { InvestigationAccordionSection } from './InvestigationAccordionSection';

afterEach(cleanup);

describe('InvestigationAccordionSection', () => {
  it('renders content open by default when defaultOpen is true', () => {
    render(
      <InvestigationAccordionSection title="Findings" defaultOpen contentTestId="section-content">
        <div>Root cause found.</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByRole('button', { name: /findings/i }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByTestId('section-content')).toBeTruthy();
    expect(screen.getByText('Root cause found.')).toBeTruthy();
  });

  it('starts collapsed when defaultOpen is false', () => {
    render(
      <InvestigationAccordionSection
        title="Acceptance Criteria"
        defaultOpen={false}
        contentTestId="section-content"
      >
        <div>Criterion body.</div>
      </InvestigationAccordionSection>,
    );

    expect(
      screen.getByRole('button', { name: /acceptance criteria/i }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByTestId('section-content')).toBeNull();
    expect(screen.queryByText('Criterion body.')).toBeNull();
  });

  it('defaults to collapsed when defaultOpen is omitted', () => {
    render(
      <InvestigationAccordionSection title="Engineering Spec" contentTestId="section-content">
        <div>Spec body.</div>
      </InvestigationAccordionSection>,
    );

    expect(
      screen.getByRole('button', { name: /engineering spec/i }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByTestId('section-content')).toBeNull();
  });

  it('renders optional metadata in the header', () => {
    render(
      <InvestigationAccordionSection
        title="Open Questions"
        badge={<span>2 unresolved</span>}
        icon={FlaskConical}
      >
        <div>Question body.</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByText('2 unresolved')).toBeTruthy();
    expect(screen.getByRole('button', { name: /open questions/i })).toBeTruthy();
    expect(document.querySelector('svg')).toBeTruthy();
  });

  it('toggles content visibility and aria-expanded when clicked', async () => {
    render(
      <InvestigationAccordionSection title="Investigation Trail" contentTestId="section-content">
        <div>Decision timeline.</div>
      </InvestigationAccordionSection>,
    );

    const header = screen.getByRole('button', { name: /investigation trail/i });

    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('section-content')).toBeTruthy();
    expect(screen.getByText('Decision timeline.')).toBeTruthy();

    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('section-content')).toBeNull();
  });

  it('resets open state when the accordion identity changes', async () => {
    const { rerender } = render(
      <InvestigationAccordionSection
        title="Findings"
        defaultOpen={false}
        resetKey="issue-1"
        contentTestId="section-content"
      >
        <div>Issue one.</div>
      </InvestigationAccordionSection>,
    );

    const header = screen.getByRole('button', { name: /findings/i });
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');

    rerender(
      <InvestigationAccordionSection
        title="Findings"
        defaultOpen={false}
        resetKey="issue-2"
        contentTestId="section-content"
      >
        <div>Issue two.</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByRole('button', { name: /findings/i }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByTestId('section-content')).toBeNull();
  });
});
