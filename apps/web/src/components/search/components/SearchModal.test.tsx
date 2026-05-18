/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchModal } from './SearchModal';

afterEach(() => {
  cleanup();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderModal(open: boolean, onClose: () => void = () => {}) {
  return render(
    <Providers>
      <SearchModal open={open} onClose={onClose} />
    </Providers>,
  );
}

describe('SearchModal', () => {
  it('does not render when open=false', () => {
    renderModal(false);
    expect(screen.queryByTestId('search-modal')).toBeNull();
  });

  it('renders the modal, input, filter chips, and idle body when open', () => {
    renderModal(true);
    expect(screen.getByTestId('search-modal')).toBeTruthy();
    expect(screen.getByTestId('search-input')).toBeTruthy();
    expect(screen.getByTestId('search-filters')).toBeTruthy();
    expect(screen.getByTestId('search-body').textContent).toContain('Start typing');
  });

  it('focuses the input on open', () => {
    renderModal(true);
    expect(document.activeElement).toBe(screen.getByTestId('search-input'));
  });

  it('calls onClose when Escape is pressed at the document level', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed inside the focused input', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    const input = screen.getByTestId('search-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.click(screen.getByTestId('search-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the card itself is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.click(screen.getByTestId('search-input'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.click(screen.getByTestId('search-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filter chips are disabled placeholders for v0', () => {
    renderModal(true);
    const filters = screen.getByTestId('search-filters');
    const buttons = filters.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.hasAttribute('disabled')).toBe(true);
    }
  });
});
