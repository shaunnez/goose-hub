/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bug } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { InvestigationAccordionSection } from './InvestigationAccordionSection';

afterEach(cleanup);

describe('InvestigationAccordionSection', () => {
  it('renders expanded by default when defaultOpen is true', () => {
    render(
      <InvestigationAccordionSection
        title="Findings"
        summary="1 issue"
        icon={<Bug size={12} />}
        defaultOpen
        testId="findings-section"
      >
        <div data-testid="findings-content">Root cause</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByTestId('findings-section')).toBeTruthy();
    expect(screen.getByTestId('findings-content')).toBeTruthy();
  });

  it('toggles collapsed content while preserving section and content test ids', () => {
    render(
      <InvestigationAccordionSection
        title="Open questions"
        summary="1 question"
        icon={<Bug size={12} />}
        testId="open-questions-section"
      >
        <div data-testid="open-questions-list">Question body</div>
      </InvestigationAccordionSection>,
    );

    expect(screen.getByTestId('open-questions-section')).toBeTruthy();
    expect(screen.queryByTestId('open-questions-list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /open questions/i }));
    expect(screen.getByTestId('open-questions-list')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /open questions/i }));
    expect(screen.queryByTestId('open-questions-list')).toBeNull();
  });
});
