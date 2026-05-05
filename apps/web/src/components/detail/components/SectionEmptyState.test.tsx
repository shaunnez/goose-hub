/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { Clock } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { SectionEmptyState } from './SectionEmptyState';

afterEach(cleanup);

describe('SectionEmptyState', () => {
  it('renders title and subtitle', () => {
    render(<SectionEmptyState title="Nothing here" subtitle="Come back later" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Come back later')).toBeTruthy();
  });

  it('renders icon when provided', () => {
    const { container } = render(
      <SectionEmptyState icon={Clock} title="Waiting" subtitle="Not yet" />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders without icon when icon prop is omitted', () => {
    const { container } = render(<SectionEmptyState title="No icon" subtitle="sub" />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('forwards data-testid to the container', () => {
    render(<SectionEmptyState data-testid="my-empty" title="test" subtitle="sub" />);
    expect(screen.getByTestId('my-empty')).toBeTruthy();
  });

  it('renders children inside the container', () => {
    render(
      <SectionEmptyState title="test" subtitle="sub">
        <button type="button">Action</button>
      </SectionEmptyState>,
    );
    expect(screen.getByRole('button', { name: 'Action' })).toBeTruthy();
  });

  it('renders ReactNode subtitle (e.g. with inline code)', () => {
    render(
      <SectionEmptyState
        title="Retro"
        subtitle={
          <>
            Merges to <code>factory:done</code>
          </>
        }
      />,
    );
    expect(screen.getByText(/Merges to/)).toBeTruthy();
    expect(screen.getByText('factory:done')).toBeTruthy();
  });

  it('applies dashed border card classes', () => {
    const { container } = render(<SectionEmptyState title="t" subtitle="s" />);
    const card = container.firstElementChild;
    expect(card?.className).toContain('border-dashed');
    expect(card?.className).toContain('rounded-lg');
  });
});
