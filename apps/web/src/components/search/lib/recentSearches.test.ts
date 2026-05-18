/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearRecentSearches, loadRecentSearches, pushRecentSearch } from './recentSearches';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recentSearches', () => {
  it('returns an empty array before anything is stored', () => {
    expect(loadRecentSearches()).toEqual([]);
  });

  it('persists pushed queries in most-recent-first order', () => {
    pushRecentSearch('alpha');
    pushRecentSearch('beta');
    pushRecentSearch('gamma');
    expect(loadRecentSearches()).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('deduplicates: re-pushing an existing query moves it to the head', () => {
    pushRecentSearch('alpha');
    pushRecentSearch('beta');
    pushRecentSearch('alpha');
    expect(loadRecentSearches()).toEqual(['alpha', 'beta']);
  });

  it('caps storage at 5 entries', () => {
    for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) pushRecentSearch(q);
    expect(loadRecentSearches()).toEqual(['g', 'f', 'e', 'd', 'c']);
  });

  it('ignores empty / whitespace pushes', () => {
    pushRecentSearch('alpha');
    pushRecentSearch('   ');
    pushRecentSearch('');
    expect(loadRecentSearches()).toEqual(['alpha']);
  });

  it('clearRecentSearches removes all entries', () => {
    pushRecentSearch('alpha');
    clearRecentSearches();
    expect(loadRecentSearches()).toEqual([]);
  });

  it('tolerates corrupt JSON in storage', () => {
    window.localStorage.setItem('goose-hub:search:recents', 'not-json');
    expect(loadRecentSearches()).toEqual([]);
  });

  it('tolerates a non-array payload in storage', () => {
    window.localStorage.setItem('goose-hub:search:recents', JSON.stringify({ q: 'x' }));
    expect(loadRecentSearches()).toEqual([]);
  });
});
