/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InvestigationAccordionSection } from './InvestigationAccordionSection';

afterEach(cleanup);

describe('InvestigationAccordionSection', () => {
  it('renders expanded by default when defaultOpen is true', () => {
    render(
      <InvestigationAccordionSection
        title="Findings"
        summary="2 items"
        defaultOpen
        testId="findings"
      >
        <div>Root cause hypothesis</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByTestId('findings-trigger').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getByTestId('findings-content')).toBeTruthy();
    expect(screen.getByText('Root cause hypothesis')).toBeTruthy();
  });

  it('renders collapsed by default when defaultOpen is false', () => {
    render(
      <InvestigationAccordionSection title="Acceptance Criteria" testId="acceptance-criteria">
        <div>AC content</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByTestId('acceptance-criteria-trigger').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByTestId('acceptance-criteria-content')).toBeNull();
    expect(screen.queryByText('AC content')).toBeNull();
  });

  it('toggles content visibility when the trigger is clicked', () => {
    render(
      <InvestigationAccordionSection title="Engineering Spec" testId="engineering-spec">
        <div>Spec content</div>
      </InvestigationAccordionSection>,
    );

    const trigger = screen.getByTestId('engineering-spec-trigger');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('engineering-spec-content')).toBeTruthy();
    expect(screen.getByText('Spec content')).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('engineering-spec-content')).toBeNull();
  });
});
