import { afterEach, describe, expect, it, vi } from 'vitest';
import { ageLabel, timeAgo, truncate } from './utils';

afterEach(() => vi.restoreAllMocks());

describe('timeAgo', () => {
  function setNow(iso: string) {
    vi.setSystemTime(new Date(iso));
  }

  it('returns "just now" for under 60 seconds', () => {
    setNow('2024-01-01T12:00:30Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('just now');
  });

  it('returns minutes', () => {
    setNow('2024-01-01T12:05:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('5m ago');
  });

  it('returns hours', () => {
    setNow('2024-01-01T15:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('3h ago');
  });

  it('returns days', () => {
    setNow('2024-01-04T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('3d ago');
  });

  it('returns months', () => {
    setNow('2024-03-01T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('2mo ago');
  });

  it('returns years', () => {
    setNow('2026-01-01T12:00:00Z');
    expect(timeAgo('2024-01-01T12:00:00Z')).toBe('2y ago');
  });
});

describe('ageLabel', () => {
  function setNow(iso: string) {
    vi.setSystemTime(new Date(iso));
  }

  it('returns minutes (compact)', () => {
    setNow('2024-01-01T12:05:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('5m');
  });

  it('returns hours (compact)', () => {
    setNow('2024-01-01T15:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('3h');
  });

  it('returns days (compact)', () => {
    setNow('2024-01-04T12:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('3d');
  });

  it('returns 0m for same instant', () => {
    setNow('2024-01-01T12:00:00Z');
    expect(ageLabel('2024-01-01T12:00:00Z')).toBe('0m');
  });
});

describe('truncate', () => {
  it('returns string unchanged when at exactly max length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('returns string unchanged when under max length', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates and appends ellipsis when over max', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('trims trailing whitespace before ellipsis', () => {
    expect(truncate('hello   ', 7)).toBe('hello…');
  });
});
