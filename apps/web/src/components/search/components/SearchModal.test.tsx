/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchModal } from './SearchModal';

afterEach(() => {
  cleanup();
});

describe('SearchModal', () => {
  it('does not render when open=false', () => {
    render(<SearchModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });

  it('renders the modal, input, filter chips, and body placeholder when open', () => {
    render(<SearchModal open={true} onClose={() => {}} />);
    expect(screen.getByTestId('search-modal')).toBeTruthy();
    expect(screen.getByTestId('search-input')).toBeTruthy();
    expect(screen.getByTestId('search-filters')).toBeTruthy();
    expect(screen.getByTestId('search-body').textContent).toContain('Start typing');
  });

  it('focuses the input on open', () => {
    render(<SearchModal open={true} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<SearchModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<SearchModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('search-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the card itself is clicked', () => {
    const onClose = vi.fn();
    render(<SearchModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('search-input'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<SearchModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('search-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filter chips are disabled placeholders for v0', () => {
    render(<SearchModal open={true} onClose={() => {}} />);
    const filters = screen.getByTestId('search-filters');
    const buttons = filters.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.hasAttribute('disabled')).toBe(true);
    }
  });
});
