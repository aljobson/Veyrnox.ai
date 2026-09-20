'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FAQ, PRESETS, MODELS as MODELS_FALLBACK, SITE_PAGES } from '../_lib/tokens';
import { searchIndex, MIN_QUERY } from '../_lib/searchIndex';

// Site-wide search. Everything this site contains is either a route, a
// catalog row, a preset or an FAQ answer, and all four fit in memory — so
// this is a client-side index, not a search service. Models come from the
// live catalog on first open and fall back to tokens.js.

function staticIndex() {
  return [
    ...SITE_PAGES.map((p) => ({
      group: 'Pages',
      title: p.label,
      detail: p.description,
      href: p.href,
    })),
    ...PRESETS.map((p) => ({
      group: 'Presets',
      title: p.name,
      detail: `${p.category} · ${p.model} · ${p.credits} cr`,
      href: '/presets',
    })),
    ...FAQ.map((f) => ({
      group: 'FAQ',
      title: f.q,
      detail: f.a,
      href: '/#faq',
    })),
  ];
}

function modelsToIndex(models) {
  return models.map((m) => ({
    group: 'Models',
    title: m.name,
    detail: `${m.modality || m.kind} · ${m.credits} cr${m.gated ? ' · premium' : ''}`,
    href: `/app/create?model=${encodeURIComponent(m.id)}`,
  }));
}

export function SiteSearch({ className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-print="hide"
        aria-label="Search Veyrnox"
        className={`inline-flex h-9 items-center gap-2 rounded-full border border-vx-border px-3 text-[13px] font-semibold text-vx-fg-muted transition-colors hover:border-vx-accent hover:text-vx-fg ${className}`}
      >
        <span aria-hidden="true">⌕</span>
        <span className="hidden md:inline">Search</span>
      </button>
      {open && <SearchOverlay onClose={() => setOpen(false)} />}
      <SearchHotkey onOpen={() => setOpen(true)} />
    </>
  );
}

// ⌘K / Ctrl-K, and `/` when the visitor is not already typing somewhere.
function SearchHotkey({ onOpen }) {
  useEffect(() => {
    function onKey(e) {
      const typing = /^(input|textarea|select)$/i.test(e.target?.tagName || '') || e.target?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
  return null;
}

function SearchOverlay({ onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [models, setModels] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Live catalog, with the bundled list as the floor so search works offline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.models) && data.models.length) setModels(data.models);
      } catch {
        // Fallback below.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const index = useMemo(
    () => [...staticIndex(), ...modelsToIndex(models || MODELS_FALLBACK)],
    [models],
  );
  const results = useMemo(() => searchIndex(index, query), [index, query]);

  useEffect(() => setCursor(0), [query]);

  const go = useCallback(
    (item) => {
      if (!item) return;
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  function onKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]); }
  }

  const short = query.trim().length > 0 && query.trim().length < MIN_QUERY;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search Veyrnox"
      data-print="hide"
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-vx-border px-4">
          <span aria-hidden="true" className="text-vx-fg-muted">⌕</span>
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="vx-search-results"
            aria-activedescendant={results.length ? `vx-search-opt-${cursor}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search models, presets, pages, FAQ…"
            aria-label="Search query"
            className="w-full bg-transparent py-4 text-[15px] text-vx-fg outline-none placeholder:text-vx-fg-faint"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 px-2 text-xl leading-none text-vx-fg-muted hover:text-vx-fg"
          >
            ×
          </button>
        </div>

        <div id="vx-search-results" className="max-h-[52vh] overflow-y-auto" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-vx-fg-muted">
              {query.trim() === ''
                ? 'Type to search the catalog, presets, pages and FAQ.'
                : short
                  ? `Keep typing — ${MIN_QUERY} characters minimum.`
                  : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            results.map((item, i) => (
              <button
                key={`${item.group}:${item.title}:${item.href}`}
                type="button"
                id={`vx-search-opt-${i}`}
                role="option"
                aria-selected={i === cursor}
                // Focus stays in the input; the listbox is driven by
                // aria-activedescendant, so options must not be tab stops.
                tabIndex={-1}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(item)}
                className={`flex w-full items-start gap-3 px-5 py-3 text-left transition-colors ${
                  i === cursor ? 'bg-vx-accent/[0.08]' : 'hover:bg-vx-accent/[0.05]'
                }`}
              >
                <span className="mt-0.5 w-[62px] shrink-0 font-vx-mono text-[9px] uppercase tracking-[0.12em] text-vx-fg-faint">
                  {item.group}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold text-vx-fg">{item.title}</span>
                  {item.detail && (
                    <span className="mt-0.5 block truncate text-[12px] text-vx-fg-muted">{item.detail}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-vx-border px-5 py-2.5 font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-faint">
          <span>↑↓ MOVE · ↵ OPEN · ESC CLOSE</span>
          <span>{results.length} RESULT{results.length === 1 ? '' : 'S'}</span>
        </div>
      </div>
    </div>
  );
}
