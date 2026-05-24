import { FileCode2 } from 'lucide-react';
import { flushSync } from 'react-dom';
import { type Root, createRoot } from 'react-dom/client';
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { SectionAccordion } from './SectionAccordion';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

function renderAccordion(node: JSX.Element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => {
    root?.render(node);
  });
}

function getByTestId(testId: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element with data-testid ${testId}`);
  }
  return element;
}

describe('SectionAccordion', () => {
  it('renders open by default when defaultOpen is true', () => {
    renderAccordion(
      <SectionAccordion
        title="Findings"
        summary="2 items"
        icon={<FileCode2 size={12} />}
        defaultOpen
        testId="findings"
      >
        <div>Root cause found</div>
      </SectionAccordion>,
    );

    const toggle = getByTestId('findings-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('findings-content').textContent).toContain('Root cause found');
    expect(container?.textContent).toContain('2 items');
  });

  it('renders closed by default when defaultOpen is false', () => {
    renderAccordion(
      <SectionAccordion title="Acceptance Criteria" defaultOpen={false} testId="acceptance">
        <div>Criterion body</div>
      </SectionAccordion>,
    );

    const toggle = getByTestId('acceptance-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-testid="acceptance-content"]')).toBeNull();
    expect(container?.textContent).not.toContain('Criterion body');
  });

  it('toggles content visibility when the header button is clicked', () => {
    renderAccordion(
      <SectionAccordion title="Engineering Spec" testId="spec">
        <div>Spec body</div>
      </SectionAccordion>,
    );

    const toggle = getByTestId('spec-toggle');
    expect(container?.textContent).not.toContain('Spec body');

    flushSync(() => {
      toggle.click();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('spec-content').textContent).toContain('Spec body');

    flushSync(() => {
      toggle.click();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-testid="spec-content"]')).toBeNull();
    expect(container?.textContent).not.toContain('Spec body');
  });
});
