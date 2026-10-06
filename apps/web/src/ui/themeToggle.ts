import type { Theme } from '../state/theme';

/** Button that switches between the light and dark themes. */
export function mountThemeToggle(root: HTMLElement, initial: Theme, onChange: (theme: Theme) => void) {
  let theme = initial;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';

  function label() {
    button.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    label();
    onChange(theme);
  });
  label();
  root.append(button);
}
