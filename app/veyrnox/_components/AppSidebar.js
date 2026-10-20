'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';

const COLLAPSED_KEY = 'veyrnox_sidebar_collapsed';
const SECTIONS_KEY = 'veyrnox_sidebar_sections';

// Per-viewer convenience only: every read and write tolerates blocked storage.
function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

function SectionHeading({ id, label, open, onToggle, rail }) {
  if (rail) return <div role="separator" className="mx-3 my-2 border-t border-vx-border" />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`vx-side-${id}`}
      className="flex w-full items-center gap-2 px-3 pb-1.5 pt-4 text-start font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-fg-muted hover:text-vx-fg"
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className="rtl:-scale-x-100" />
      {label}
    </button>
  );
}

function featuredClasses(current) {
  return current
    ? 'bg-vx-accent text-vx-accent-ink'
    : 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20';
}

// OpenArt-style left rail: home, then Agents / Tools / Assets / Inspire. Fixed
// beside the page on desktop; the Studio menu keeps carrying phones.
// veyrnox.css pads .vx-root by the rail's width while this is mounted.
export function AppSidebar({ sections, homeLabel, logoLabel, accountLabel, accountHref, activeKey, activeHref, label, collapseLabel, expandLabel }) {
  const [rail, setRail] = useState(false);
  const [closed, setClosed] = useState({});
  useEffect(() => {
    setRail(readStore(COLLAPSED_KEY, false) === true);
    setClosed(readStore(SECTIONS_KEY, {}));
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-vx-rail', rail);
  }, [rail]);
  useEffect(() => () => document.documentElement.removeAttribute('data-vx-rail'), []);

  const toggleRail = () => {
    setRail((prev) => {
      writeStore(COLLAPSED_KEY, !prev);
      return !prev;
    });
  };
  const toggleSection = (id) => {
    setClosed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeStore(SECTIONS_KEY, next);
      return next;
    });
  };
  const isCurrent = (item) => (item.key ? item.key === activeKey : item.href === activeHref);

  return (
    <aside
      data-print="hide"
      aria-label={label}
      className="vx-sidebar fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-vx-border bg-vx-base lg:flex"
    >
      <div className={`flex h-16 shrink-0 items-center ${rail ? 'justify-center' : 'justify-between px-4'}`}>
        {!rail && (
          <Link href="/app" aria-label={logoLabel} className="flex items-center">
            <Logo wordmark />
          </Link>
        )}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={rail ? expandLabel : collapseLabel}
          aria-pressed={rail}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-vx-fg-muted hover:bg-vx-panel hover:text-vx-fg"
        >
          <Icon name="panel" size={18} className="rtl:-scale-x-100" />
        </button>
      </div>

      <nav aria-label={label} className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-6">
        {accountLabel && (
          <Link
            href={accountHref}
            title={accountLabel}
            className={`mb-1 flex items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel py-2.5 text-sm font-semibold text-vx-fg hover:border-vx-accent ${rail ? 'justify-center px-0' : 'px-3'}`}
          >
            <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-vx-accent text-xs font-bold text-vx-accent-ink">
              {accountLabel.trim().charAt(0).toUpperCase()}
            </span>
            {!rail && <span className="min-w-0 flex-1 truncate">{accountLabel}</span>}
            {!rail && <Icon name="chevronRight" size={14} className="text-vx-fg-muted rtl:-scale-x-100" />}
          </Link>
        )}

        <Link
          href="/app"
          title={homeLabel}
          aria-current={activeKey === 'explore' ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-xl py-2.5 text-sm font-semibold transition-colors ${rail ? 'justify-center px-0' : 'px-3'} ${
            activeKey === 'explore' ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg'
          }`}
        >
          <Icon name="home" size={18} />
          {!rail && homeLabel}
        </Link>

        {sections.map((section) => {
          const open = !closed[section.id];
          return (
            <div key={section.id}>
              <SectionHeading id={section.id} label={section.label} open={open} rail={rail} onToggle={() => toggleSection(section.id)} />
              {(open || rail) && (
                <ul
                  id={`vx-side-${section.id}`}
                  className={section.grid && !rail ? 'grid grid-cols-2 gap-1.5' : 'flex flex-col gap-1'}
                >
                  {section.items.map((item) => {
                    const current = isCurrent(item);
                    const tile = section.grid && !rail;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={item.label}
                          aria-current={current ? 'page' : undefined}
                          className={`flex items-center rounded-xl text-sm font-semibold transition-colors ${
                            rail ? 'justify-center px-0 py-2.5' : tile ? 'gap-1.5 px-2 py-2.5 text-[13px]' : 'gap-3 px-3 py-2.5'
                          } ${
                            item.featured && !rail
                              ? featuredClasses(current)
                              : current
                                ? 'bg-vx-panel text-vx-fg'
                                : 'text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg'
                          }`}
                        >
                          <Icon name={item.icon} size={tile ? 16 : 18} />
                          {!rail && <span className="min-w-0 truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
