/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

afterEach(() => {
  cleanup();
});

function Harness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, active);
  return (
    <div ref={ref} data-testid="trap">
      <button type="button" data-testid="first">
        first
      </button>
      <button type="button" data-testid="middle">
        middle
      </button>
      <button type="button" data-testid="last">
        last
      </button>
    </div>
  );
}

function tabKey(shift: boolean): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true });
}

describe('useFocusTrap', () => {
  it('does nothing when inactive', () => {
    const { getByTestId } = render(<Harness active={false} />);
    const last = getByTestId('last') as HTMLButtonElement;
    last.focus();
    document.dispatchEvent(tabKey(false));
    // No trap → activeElement stays on `last` (browser would move it, but
    // jsdom doesn't simulate native focus advancement). The point is the
    // hook didn't intercept and redirect.
    expect(document.activeElement).toBe(last);
  });

  it('wraps Tab on the last focusable back to the first', () => {
    const { getByTestId } = render(<Harness active={true} />);
    const first = getByTestId('first') as HTMLButtonElement;
    const last = getByTestId('last') as HTMLButtonElement;
    last.focus();
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(tabKey(false));
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab on the first focusable back to the last', () => {
    const { getByTestId } = render(<Harness active={true} />);
    const first = getByTestId('first') as HTMLButtonElement;
    const last = getByTestId('last') as HTMLButtonElement;
    first.focus();
    document.dispatchEvent(tabKey(true));
    expect(document.activeElement).toBe(last);
  });

  it('ignores non-Tab keys', () => {
    const { getByTestId } = render(<Harness active={true} />);
    const middle = getByTestId('middle') as HTMLButtonElement;
    middle.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(middle);
  });

  it('does not redirect Tab when focus is on a middle element', () => {
    const { getByTestId } = render(<Harness active={true} />);
    const middle = getByTestId('middle') as HTMLButtonElement;
    middle.focus();
    document.dispatchEvent(tabKey(false));
    // Trap only acts at the boundaries; middle stays put (in jsdom).
    expect(document.activeElement).toBe(middle);
  });
});
