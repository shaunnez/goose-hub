/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatCard } from './StatCard';

afterEach(cleanup);

describe('StatCard', () => {
  it('renders label, value, and sub text', () => {
    render(<StatCard label="Last agent" value="Rogue Pinion (GRL)" sub="5 runs" />);
    expect(screen.getByText('Last agent')).toBeTruthy();
    expect(screen.getByText('Rogue Pinion (GRL)')).toBeTruthy();
    expect(screen.getByText('5 runs')).toBeTruthy();
  });

  it('renders without sub text when sub is undefined', () => {
    render(<StatCard label="Last agent" value="Rogue Pinion (GRL)" />);
    expect(screen.getByText('Last agent')).toBeTruthy();
    expect(screen.getByText('Rogue Pinion (GRL)')).toBeTruthy();
    expect(screen.queryByText('5 runs')).toBeNull();
  });

  it('applies correct font size and spacing to components', () => {
    const { container } = render(<StatCard label="Status" value="Complete" sub="Info" />);
    // Verify label is text-[10.5px]
    const labelDivs = Array.from(container.querySelectorAll('.text-\\[10\\.5px\\]'));
    expect(labelDivs.some((el) => el.textContent === 'Status')).toBe(true);
    // Verify sub is text-[11px]
    const subDivs = Array.from(container.querySelectorAll('.text-\\[11px\\]'));
    expect(subDivs.some((el) => el.textContent === 'Info')).toBe(true);
  });

  it('applies text-[14px] class to value for appropriate sizing', () => {
    const { container } = render(<StatCard label="Test" value="Value" />);
    const valueDiv = container.querySelector('.text-\\[14px\\]');
    expect(valueDiv).toBeTruthy();
    expect(valueDiv?.textContent).toBe('Value');
  });

  it('applies text-[10.5px] class to label', () => {
    const { container } = render(<StatCard label="Test" value="Value" />);
    const labelDiv = container.querySelector('.text-\\[10\\.5px\\]');
    expect(labelDiv).toBeTruthy();
    expect(labelDiv?.textContent).toBe('Test');
  });

  it('applies text-[11px] class to sub text', () => {
    const { container } = render(<StatCard label="Test" value="Value" sub="Subtext" />);
    const subDivs = Array.from(container.querySelectorAll('.text-\\[11px\\]'));
    expect(subDivs.length).toBeGreaterThan(0);
    const subDiv = subDivs.find((el) => el.textContent === 'Subtext');
    expect(subDiv).toBeTruthy();
  });
});
