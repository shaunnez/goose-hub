/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';

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

function renderTopBar() {
  return render(
    <Providers>
      <TopBar />
    </Providers>,
  );
}

describe('TopBar', () => {
  it('opens Capture when Cmd+J is pressed', () => {
    renderTopBar();

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    expect(screen.getByText('Capture idea')).toBeTruthy();
    expect(screen.getByTestId('capture-title-input')).toBeTruthy();
  });

  it('opens Capture when Ctrl+J is pressed', () => {
    renderTopBar();

    fireEvent.keyDown(document, { key: 'j', ctrlKey: true });

    expect(screen.getByText('Capture idea')).toBeTruthy();
    expect(screen.getByTestId('capture-title-input')).toBeTruthy();
  });
});
