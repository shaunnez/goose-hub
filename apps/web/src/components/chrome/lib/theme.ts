export const THEME_STORAGE_KEY = 'theme';

export type ThemeMode = 'light' | 'dark';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function getStoredTheme(): ThemeMode | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function getActiveTheme(): ThemeMode {
  const stored = getStoredTheme();
  if (stored != null) return stored;

  if (typeof document !== 'undefined') {
    const current = document.documentElement.getAttribute('data-theme');
    if (isThemeMode(current)) return current;
  }

  return 'dark';
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function persistTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
}

export function initializeTheme() {
  applyTheme(getActiveTheme());
}
