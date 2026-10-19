'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../../components/I18nProvider';
import { LOCALES, localeInfo, switchLanguageHref } from '../../../lib/i18n/locales.mjs';
import { isAppLocalePath, rememberLocale } from '../../../lib/i18n/localeCookie.mjs';

// The language picker in the public nav: the current language's flag opens a
// list of every language, each a plain link (it works without script and a
// crawler can follow it). Nothing renders while languages are off.
export function LanguageMenu({ className = '', id = 'vx-language-menu' }) {
  const { locale, languagesEnabled, t } = useI18n();
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  if (!languagesEnabled || /^\/app\/admin(?:\/|$)/.test(pathname)) return null;
  const current = localeInfo(locale);

  return (
    <div ref={wrapRef} data-print="hide" className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${t('ui.language')}: ${current.name}`}
        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-vx-border px-3 text-[13px] font-semibold text-vx-fg-body transition-colors hover:border-vx-accent hover:text-vx-fg"
      >
        <span aria-hidden="true" className="text-[18px] leading-none">{current.flag}</span>
        <span aria-hidden="true" className="hidden lg:inline">{current.name}</span>
        <span aria-hidden="true" className="text-[10px] text-vx-fg-muted">▾</span>
      </button>
      {open && (
        <ul
          id={id}
          className="absolute end-0 top-full z-50 mt-2 max-h-[calc(100dvh-5rem)] w-56 overflow-y-auto rounded-xl border border-vx-border bg-vx-panel p-1.5 shadow-2xl"
        >
          {LOCALES.map((l) => (
            <li key={l.code}>
              <a
                href={switchLanguageHref(l.code, pathname)}
                hrefLang={l.hreflang}
                lang={l.hreflang}
                aria-current={l.code === locale ? 'true' : undefined}
                data-locale={l.code}
                onClick={(event) => {
                  rememberLocale(l.code);
                  setOpen(false);
                  if (isAppLocalePath(pathname) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                    event.preventDefault();
                    // Refresh server components and retain the query and hash.
                    window.location.reload();
                  }
                }}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${l.code === locale ? 'bg-vx-base font-bold text-vx-fg' : 'text-vx-fg-body hover:bg-vx-fg/[0.05] hover:text-vx-fg'}`}
              >
                <span aria-hidden="true" className="text-[18px] leading-none">{l.flag}</span>
                <span>{l.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
