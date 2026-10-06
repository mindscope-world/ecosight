export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'atlas-theme';

/** A saved choice wins; otherwise the theme follows the device setting. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

// Storage can be blocked (private windows, strict settings); the theme then lasts for the visit.
export function loadTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {}
  return resolveTheme(stored, matchMedia('(prefers-color-scheme: dark)').matches);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
