import { describe, expect, it } from 'vitest';
import { CODENAMES, generateCodename, getInitials, formatPersonaLabel } from './persona-names.js';

describe('generateCodename', () => {
  it('returns first name for index 0', () => {
    expect(generateCodename(0)).toBe('Grey Honker');
  });

  it('returns 16th name for index 15', () => {
    expect(generateCodename(15)).toBe('Tundra Drift');
  });

  it('wraps around after 30 names', () => {
    expect(generateCodename(30)).toBe(generateCodename(0));
    expect(generateCodename(31)).toBe(generateCodename(1));
  });

  it('CODENAMES has exactly 30 entries', () => {
    expect(CODENAMES).toHaveLength(30);
  });

  it('all names are unique', () => {
    expect(new Set(CODENAMES).size).toBe(30);
  });
});

describe('getInitials', () => {
  it('returns first letter of each word', () => {
    expect(getInitials('Grey Honker')).toBe('GH');
    expect(getInitials('Tundra Drift')).toBe('TD');
    expect(getInitials('Iron Beak')).toBe('IB');
  });
});

describe('formatPersonaLabel', () => {
  it('formats codename with role abbreviation', () => {
    expect(formatPersonaLabel('Grey Honker', 'developer')).toBe('Grey Honker (DEV)');
    expect(formatPersonaLabel('Iron Beak', 'qa')).toBe('Iron Beak (QA)');
  });

  it('falls back to uppercase slice for unknown roles', () => {
    expect(formatPersonaLabel('Silent Wing', 'unknown-role')).toBe('Silent Wing (UNK)');
  });
});
