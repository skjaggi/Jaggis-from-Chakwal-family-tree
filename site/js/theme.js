// Light/dark switch. With no choice saved, the site follows the device's
// setting; a choice is remembered on this device only. The saved choice is
// applied before the page draws by a one-line script in each page's <head>.
const KEY = 'theme';
const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function currentTheme() {
  return document.documentElement.dataset.theme || (dark() ? 'dark' : 'light');
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    // Picking what the device already uses means "follow the device" again.
    if (next === (dark() ? 'dark' : 'light')) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next);
  } catch { /* private mode: applies for this visit only */ }
  return next;
}
