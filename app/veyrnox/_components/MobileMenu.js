'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { Icon } from './Icon';
import { useOddlingsPublic } from './OddlingsPublicFlag';
import { navHref } from '../_lib/tokens';
import { LanguageMenu } from './LanguageMenu';
import { useI18n } from '../../../components/I18nProvider';

// A visible menu keeps every destination reachable on a narrow screen.
export function MobileMenu({ items, className = '', buttonLabel = 'Menu', buttonText = '', navLabel = 'Site', activeHref, grouped = false, languageMenu = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const oddlingsPublic = useOddlingsPublic();
  const { t, href: localHref } = useI18n();

  // A phone menu that survives a route change covers the page you just
  // opened; close it whenever it opens a link, and on Escape.
  useEffect(() => {
    if (!open) return;
    // Lock the page behind the panel. Without this the body scrolls under an
    // open menu, which on touch reads as the menu failing to scroll rather
    // than the page moving.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const renderLinks = (list) => list.map((it) => {
    // Home-page sections use a plain link, as on the marketing bar.
    const Item = it.href.includes('#') ? 'a' : Link;
    // A public page that is still behind its flag links to the studio instead.
    const href = localHref(navHref(it, oddlingsPublic));
    return (
      <li key={it.href}>
        <Item
          href={href}
          onClick={() => setOpen(false)}
          aria-current={href === activeHref ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-[15px] font-bold transition-colors ${
            href === activeHref
              ? it.featured ? 'border-vx-accent bg-vx-accent text-vx-accent-ink' : 'border-transparent bg-vx-panel text-vx-fg'
              : it.featured
                ? 'border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                : 'border-transparent text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {it.featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
            {t.label(it.label)}
          </span>
        </Item>
      </li>
    );
  });

  return (
    <div className={className} data-print="hide">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vx-mobile-menu"
        aria-label={buttonLabel}
        className={`inline-flex h-11 items-center justify-center rounded-full border border-vx-border text-vx-fg-body hover:border-vx-accent hover:text-vx-fg ${buttonText ? 'gap-2 px-3' : 'w-11'}`}
      >
        <Icon name={open ? 'close' : 'menu'} size={18} />
        {buttonText && <span className="text-[13px] font-bold">{buttonText}</span>}
      </button>

      {open && (
        <>
          {/* Height in dvh, not `bottom-0`: the nav's backdrop blur makes it the
              containing block for `fixed` children, so top and bottom both
              measured from the 64px bar and the scrim was 0px tall. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="vx-fade-in fixed inset-x-0 top-16 z-30 h-dvh cursor-default bg-black/50"
          />
          <nav
            id="vx-mobile-menu"
            aria-label={navLabel}
            className="vx-drop-in fixed inset-x-0 top-16 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-vx-border bg-vx-base px-4 py-3 shadow-xl"
          >
            {grouped ? (
              // A mega panel: one titled column per group, in the order the
              // groups first appear in the list.
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                {[...new Set(items.map((it) => it.group))].map((group) => (
                  <section key={group} aria-label={t.label(group)}>
                    <p className="px-3 pb-1 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint uppercase">{t.label(group)}</p>
                    <ul className="grid gap-1">{renderLinks(items.filter((it) => it.group === group))}</ul>
                  </section>
                ))}
              </div>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{renderLinks(items)}</ul>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-vx-border pt-3">
              <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">{t('ui.theme')}</span>
              <div className="flex items-center gap-2">{languageMenu && <LanguageMenu id="vx-studio-language-menu" />}<ThemeToggle /></div>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
