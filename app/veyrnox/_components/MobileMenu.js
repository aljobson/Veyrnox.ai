'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

// Hamburger + slide-down panel for the marketing navs. Below `sm` the nav
// links were either hidden outright (MarketingNav) or pushed into a
// horizontal scroller nobody scrolls (the landing nav), so on a phone half
// the site was unreachable from the header.
export function MobileMenu({ items, className = '' }) {
  const [open, setOpen] = useState(false);

  // A phone menu that survives a route change covers the page you just
  // opened; close it whenever it opens a link, and on Escape.
  useEffect(() => {
    if (!open) return;
    // Lock the page behind the panel. Without this the body scrolls under an
    // open menu, which on touch reads as the menu failing to scroll rather
    // than the page moving.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={className} data-print="hide">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vx-mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-vx-border text-vx-fg-body hover:border-vx-accent hover:text-vx-fg"
      >
        <span aria-hidden="true" className="text-base leading-none">{open ? '✕' : '☰'}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-16 z-30 cursor-default bg-black/50"
          />
          <nav
            id="vx-mobile-menu"
            aria-label="Site"
            className="fixed inset-x-0 top-16 z-40 border-b border-vx-border bg-vx-base px-4 py-3 shadow-xl"
          >
            <ul className="flex flex-col">
              {items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-3 text-[15px] font-bold text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg"
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
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
