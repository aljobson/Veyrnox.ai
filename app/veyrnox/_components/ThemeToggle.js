'use client';

import { cn } from '../../../lib/utils';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../../../components/I18nProvider';

// Dark is the default and the brand; light and "system" (follow the device)
// are opt-in. The choice is remembered in the `veyrnox_theme` cookie, which
// app/layout.js reads on the server and writes onto <html data-theme>, so the
// first paint is already right and no inline script is needed (the CI grep gate
// bans raw-markup escape hatches in first-party code, and the CSP has no
// 'unsafe-inline'). localStorage is only read to migrate a choice made before
// the cookie existed. The palette itself is the CSS variables in
// app/globals.css; "system" is a prefers-color-scheme block there, so it too
// paints correctly before any script runs.
import { THEME_COOKIE, parseTheme, resolveTheme, themeCookie } from '../../../lib/themePreference.mjs';

const KEY = 'veyrnox_theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const cookieTheme = () => {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE}=`));
    return parseTheme(hit && hit.slice(THEME_COOKIE.length + 1));
  } catch {
    return null;
  }
};

export function readStoredTheme() {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener());
let watching = false;
const subscribe = (listener) => {
  listeners.add(listener);
  // The device setting can change while the page is open (sunset schedules).
  if (!watching && typeof matchMedia === 'function') {
    watching = true;
    matchMedia(LIGHT_QUERY).addEventListener('change', notify);
  }
  return () => listeners.delete(listener);
};

/** light, dark or system: what the visitor picked. */
export const currentChoice = () => parseTheme(document.documentElement.getAttribute('data-theme')) || cookieTheme() || readStoredTheme() || 'dark';
/** light or dark: what is on screen right now. */
const currentTheme = () => resolveTheme(currentChoice(), typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches);
const serverTheme = () => 'dark';

export function applyTheme(choice) {
  document.documentElement.setAttribute('data-theme', choice);
  notify();
}

/** Remember a choice (cookie, so the server can paint it) and apply it. */
export function chooseTheme(choice) {
  applyTheme(choice);
  try {
    document.cookie = themeCookie(choice, location.protocol === 'https:');
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the theme still applies for this page.
  }
}

/** Apply the remembered theme. Called once from the root-mounted chrome so
 *  routes without a toggle in their nav still honour the choice. A choice
 *  that only exists in localStorage (made before the cookie) is carried over. */
export function applyStoredTheme() {
  const fromCookie = cookieTheme();
  if (fromCookie) {
    applyTheme(fromCookie);
    return fromCookie;
  }
  const stored = readStoredTheme();
  if (stored) chooseTheme(stored);
  return stored || 'dark';
}

export function ThemeToggle({ className = '' }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  const { t } = useI18n();

  useEffect(() => {
    applyStoredTheme();
  }, []);

  const toggle = useCallback(() => {
    chooseTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, []);

  const goingLight = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      data-print="hide"
      aria-label={goingLight ? t('ui.themeToLight') : t('ui.themeToDark')}
      title={goingLight ? t('ui.themeLight') : t('ui.themeDark')}
      className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-vx-border text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg', className)}
    >
      {/* Both icons ship and CSS picks one from <html data-theme>, so the right one shows before hydration. */}
      <span className="vx-theme-sun inline-flex"><Icon name="sun" size={15} /></span>
      <span className="vx-theme-moon"><Icon name="moon" size={15} /></span>
    </button>
  );
}

const CHOICES = [
  ['system', 'ui.themeSystem'],
  ['light', 'ui.themeLight'],
  ['dark', 'ui.themeDark'],
];

/** Light / Dark / System, for the account page. */
export function ThemePicker() {
  const choice = useSyncExternalStore(subscribe, currentChoice, serverTheme);
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t('ui.themeAppearance')} className="flex flex-wrap gap-2">
      {CHOICES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          data-testid={`theme-choice-${value}`}
          data-theme-choice={value}
          onClick={() => chooseTheme(value)}
          className="vx-theme-choice min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg"
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
