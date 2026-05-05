/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('./slots/ProjectSwitcherSlot', () => ({
  ProjectSwitcherSlot: () => null,
}));

// Stub localStorage so getInitialCollapsed() returns false (expanded),
// making the header label visible.
const mockStorage: Record<string, string> = {};
const localStorageStub = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value;
  },
  removeItem: (key: string) => {
    delete mockStorage[key];
  },
  clear: () => {
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  },
  get length() {
    return Object.keys(mockStorage).length;
  },
};

describe('Sidebar header label', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageStub);
    mockStorage['sidebar-collapsed'] = 'false';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  });

  it('displays "Agentic OS" not "Goose Hub"', () => {
    render(
      <MemoryRouter>
        <Sidebar activeSlug={undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Agentic OS')).toBeDefined();
    expect(screen.queryByText('Goose Hub')).toBeNull();
  });
});
