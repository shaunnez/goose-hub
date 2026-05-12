/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => <div data-testid="project-switcher-mock" />,
}));

beforeAll(() => {
  const mockLocalStorage = {
    getItem: vi.fn((key) => {
      if (key === 'sidebar-collapsed') return 'false';
      return null;
    }),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };
  vi.stubGlobal('localStorage', mockLocalStorage);
});

afterEach(cleanup);

describe('Sidebar', () => {
  it('renders GooseHUB in logo text', () => {
    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>,
    );
    // Find the span with GooseHUB text in the header
    const spans = container.querySelectorAll('span');
    const hasGooseHUB = Array.from(spans).some(
      (span) => span.textContent === 'GooseHUB' && span.className.includes('text-[14px]'),
    );
    expect(hasGooseHUB).toBe(true);
  });

  it('does not render old "Goose Hub" text with space', () => {
    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>,
    );
    const spans = container.querySelectorAll('span');
    const hasOldText = Array.from(spans).some(
      (span) => span.textContent === 'Goose Hub' && span.className.includes('text-[14px]'),
    );
    expect(hasOldText).toBe(false);
  });
});
