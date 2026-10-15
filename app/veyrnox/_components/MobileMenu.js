'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';
import { Icon } from './Icon';

// A visible menu keeps every destination reachable on a narrow screen.
export function MobileMenu({ items, className = '', buttonLabel = 'Menu', navLabel = 'Site', activeHref }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

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
    return (
      <li key={it.href}>
        <Item
          href={it.href}
          onClick={() => setOpen(false)}
          aria-current={it.href === activeHref ? 'page' : undefined}
          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-[15px] font-bold transition-colors ${
            it.href === activeHref
              ? it.featured ? 'border-vx-accent bg-vx-accent text-vx-accent-ink' : 'border-transparent bg-vx-panel text-vx-fg'
              : it.featured
                ? 'border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                : 'border-transparent text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg'
          }`}
        >
          <span className="inline-flex items-center gap-2">
            {it.featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
            {it.label}
          </span>
          {it.featured && <span className="font-vx-mono text-[9px] tracking-[0.12em] opacity-75">CHARACTERS</span>}
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
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-vx-border text-vx-fg-body hover:border-vx-accent hover:text-vx-fg"
      >
        <Icon name={open ? 'close' : 'menu'} size={18} />
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
            <ul className="flex flex-col">{renderLinks(items)}</ul>
            <div className="mt-2 flex items-center justify-between border-t border-vx-border pt-3">
              <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">THEME</span>
              <ThemeToggle />
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
