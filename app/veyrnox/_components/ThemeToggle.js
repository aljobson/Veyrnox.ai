'use client';

import { useCallback, useEffect, useState } from 'react';

// Dark is the default and the brand; light is opt-in and remembered per
// browser. The palette itself is 14 CSS variables in app/globals.css, so
// this only has to flip one attribute on <html>.
//
// There is deliberately no inline bootstrap <script>: the CI grep gate in
// .github/workflows/ci.yml forbids dangerouslySetInnerHTML in first-party
// code (it is the control that stands in for the CSP's `unsafe-inline`),
// so a returning light-theme visitor sees one frame of dark before
// hydration. The alternative is an XSS sink on every page.
const KEY = 'veyrnox_theme';

export function readStoredTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Apply the remembered theme. Called once from the root-mounted chrome so
 *  routes without a toggle in their nav still honour the choice. */
export function applyStoredTheme() {
  const stored = readStoredTheme();
  if (stored) applyTheme(stored);
  return stored || 'dark';
}

export function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    setTheme(applyStoredTheme());
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Private mode / storage blocked: the theme still applies for this page.
      }
      return next;
    });
  }, []);

  const goingLight = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      data-print="hide"
      aria-label={goingLight ? 'Switch to light theme' : 'Switch to dark theme'}
      title={goingLight ? 'Light theme' : 'Dark theme'}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-vx-border text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg ${className}`}
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {goingLight ? '☀' : '☾'}
      </span>
    </button>
  );
}
