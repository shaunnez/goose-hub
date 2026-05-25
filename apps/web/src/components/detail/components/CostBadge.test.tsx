/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CostBadge } from './CostBadge';

afterEach(cleanup);

describe('CostBadge', () => {
  it('renders tokens and cost', () => {
    render(<CostBadge tokens={1234} usd={0.12} label="exact" />);
    const badge = screen.getByTestId('cost-badge');
    expect(badge.textContent).toContain('1.2k');
    expect(badge.textContent).toContain('$0.12');
  });

  it('renders the tilde prefix when label is estimated', () => {
    render(<CostBadge tokens={500} usd={0.05} label="estimated" />);
    expect(screen.getByTestId('cost-badge').textContent).toContain('~$0.05');
  });

  it('returns null when both tokens and usd are zero', () => {
    const { container } = render(<CostBadge tokens={0} usd={0} label="exact" />);
    expect(container.querySelector('[data-testid="cost-badge"]')).toBeNull();
  });

  it('renders when only one of tokens/usd is non-zero', () => {
    render(<CostBadge tokens={42} usd={0} label="exact" />);
    expect(screen.getByTestId('cost-badge')).toBeTruthy();
  });

  it('renders cache hit ratio and reasoning tokens when present', () => {
    render(
      <CostBadge
        tokens={1234}
        usd={0.12}
        label="estimated"
        cacheHitRatio={0.22}
        reasoningOutputTokens={130}
      />,
    );

    const badge = screen.getByTestId('cost-badge');
    expect(badge.textContent).toContain('cache 22%');
    expect(badge.textContent).toContain('r 130');
    expect(badge.title).toContain('22% cache hit');
    expect(badge.title).toContain('130 reasoning tokens');
  });
});
