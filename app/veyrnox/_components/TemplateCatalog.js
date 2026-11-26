'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { writeStudioDraft } from '../_lib/landingDraft.js';

const PROVIDERS = [
  { id: 'kling', label: 'Kling', detail: 'Veyrnox-ready templates plus Kling’s live effects index' },
  { id: 'seedance', label: 'Seedance', detail: 'ByteDance effect templates, including Seedance 2.0 entries' },
  { id: 'veo', label: 'Veo', detail: 'Veyrnox-owned prompt recipes for Veo 3.1' },
  { id: 'suno', label: 'SUNO Music', detail: '100 runnable genre and mood starts' },
];

const includesQuery = (item, query) => !query || [item.name, item.category, item.model, item.tag, ...(item.tags || [])]
  .filter(Boolean).join(' ').toLocaleLowerCase().includes(query);

function Empty({ query }) {
  return <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">No templates match “{query}”.</p>;
}

function ReadyCard({ item, badge }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="relative aspect-[4/3] overflow-hidden bg-[radial-gradient(circle_at_top_left,var(--color-vx-accent),transparent_58%),linear-gradient(145deg,#0d1824,#152d3f)]">
        {item.poster && <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
        <span className="absolute start-3 top-3 rounded-full border border-white/20 bg-black/55 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur-sm">{badge}</span>
      </div>
      <div className="p-4">
        <h3 className="text-base font-black">{item.name}</h3>
        <p className="mt-1 text-xs text-vx-fg-muted">{item.category} · {item.model}{item.durationSeconds ? ` · ${item.durationSeconds}s` : ''}</p>
        <Link href={`/presets/${encodeURIComponent(item.id)}`} className="vx-press mt-4 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">Open template</Link>
      </div>
    </li>
  );
}

function ProviderCard({ item, provider }) {
  const input = item.inputCount ? `${item.inputCount} image${item.inputCount === 1 ? '' : 's'}` : item.inputRequirement;
  const price = item.prices?.length ? item.prices.map(entry => `${entry.resolution} · ${entry.providerCredits}`).join(' / ')
    : item.providerCredits !== null && item.providerCredits !== undefined ? `${item.providerCredits}` : null;
  return (
    <li className="flex min-h-64 flex-col rounded-2xl border border-vx-border bg-vx-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full bg-vx-accent/10 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-accent">{provider} effect</span>
        {item.tag && <span className="text-[10px] font-bold text-vx-fg-muted">{item.tag}</span>}
      </div>
      <h3 className="mt-4 text-lg font-black">{item.name}</h3>
      <p className="mt-1 text-xs text-vx-fg-muted">{item.category}</p>
      {input && <p className="mt-4 text-sm leading-6 text-vx-fg-body">Input: {input}</p>}
      {item.requirements?.length > 0 && <p className="mt-3 line-clamp-3 text-xs leading-5 text-vx-fg-muted">{item.requirements.slice(0, 3).map(part => `${part.label}: ${part.value}`).join(' · ')}</p>}
      {price && <p className="mt-3 text-xs text-vx-fg-muted">Provider credits: {price}</p>}
      <div className="mt-auto flex flex-wrap gap-2 pt-5">
        {item.previewUrl && <a href={item.previewUrl} target="_blank" rel="noreferrer" className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent">Open preview</a>}
        <span className="inline-flex min-h-11 items-center rounded-full bg-vx-base px-4 text-xs font-bold text-vx-fg-muted">Catalog preview</span>
      </div>
    </li>
  );
}

function VeoCard({ item, onUse }) {
  return (
    <li className="flex min-h-72 flex-col rounded-2xl border border-vx-border bg-vx-panel p-5">
      <span className="w-fit rounded-full bg-vx-hue-iris/10 px-2.5 py-1 font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-hue-iris">Veyrnox recipe</span>
      <h3 className="mt-4 text-lg font-black">{item.name}</h3>
      <p className="mt-1 text-xs text-vx-fg-muted">{item.category} · Veo 3.1 Fast · 8s</p>
      <p className="mt-4 line-clamp-5 text-sm leading-6 text-vx-fg-body">{item.prompt}</p>
      <button type="button" onClick={() => onUse(item)} className="vx-press mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">Use with Veo</button>
    </li>
  );
}

function SunoCard({ item }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <img src={item.artwork} alt="" loading="lazy" className="aspect-[4/3] w-full bg-vx-base object-cover" />
      <div className="p-4">
        <span className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-accent">SUNO music start</span>
        <h3 className="mt-2 text-base font-black">{item.name}</h3>
        <p className="mt-1 text-xs text-vx-fg-muted">{item.category} · {item.bpm} BPM · {item.musicalKey}</p>
        <Link href={`/app/music/create?sample=${encodeURIComponent(item.id)}`} className="vx-press mt-4 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">Use in SUNO</Link>
      </div>
    </li>
  );
}

export function TemplateCatalog({ kling, seedance, veo, suno }) {
  const router = useRouter();
  const [provider, setProvider] = useState('kling');
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState({ kling: null, seedance: null });
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState({});
  const requested = useRef(new Set());
  const needle = query.trim().toLocaleLowerCase();

  const loadRemote = useCallback(async (kind, page = 1) => {
    setLoading(kind);
    setError(current => ({ ...current, [kind]: '' }));
    try {
      const response = await fetch(`/api/template-catalog?provider=${kind}&page=${page}&page_size=50`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'catalog_unavailable');
      setRemote(current => {
        const previous = page === 1 ? [] : current[kind]?.templates || [];
        const byId = new Map([...previous, ...(body.templates || [])].map(item => [item.id, item]));
        return { ...current, [kind]: { ...body, templates: [...byId.values()] } };
      });
    } catch {
      setError(current => ({ ...current, [kind]: 'The live provider index is unavailable in this environment. Veyrnox-ready templates still work.' }));
    } finally {
      setLoading(current => current === kind ? null : current);
    }
  }, []);

  useEffect(() => {
    if (!['kling', 'seedance'].includes(provider) || remote[provider] || error[provider] || loading === provider || requested.current.has(provider)) return;
    requested.current.add(provider);
    queueMicrotask(() => { void loadRemote(provider, 1); });
  }, [provider, remote, error, loading, loadRemote]);

  const local = provider === 'kling' ? kling : provider === 'seedance' ? seedance : provider === 'veo' ? veo : suno;
  const visibleLocal = useMemo(() => local.filter(item => includesQuery(item, needle)), [local, needle]);
  const visibleRemote = (remote[provider]?.templates || []).filter(item => includesQuery(item, needle));

  const useVeo = item => {
    const written = writeStudioDraft(window.sessionStorage, item);
    if (written) router.push(`/app/create?model=${encodeURIComponent(item.model)}`);
  };

  const info = PROVIDERS.find(item => item.id === provider);
  return (
    <section className="mt-10" data-testid="template-catalog">
      <nav aria-label="Template provider" className="flex flex-wrap gap-2" role="tablist">
        {PROVIDERS.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={provider === item.id} onClick={() => { setProvider(item.id); setQuery(''); }}
            className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 text-sm font-bold text-vx-fg-body hover:border-vx-accent aria-selected:border-vx-accent aria-selected:bg-vx-accent aria-selected:text-vx-accent-ink">
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mt-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="vx-display text-[30px] sm:text-[38px]">{info.label} templates</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-vx-fg-muted">{info.detail}</p>
        </div>
        <label className="block w-full max-w-sm">
          <span className="sr-only">Search {info.label} templates</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${info.label}`}
            className="min-h-11 w-full rounded-xl border border-vx-field bg-vx-panel px-4 text-sm outline-none focus:border-vx-accent focus:ring-2 focus:ring-vx-accent/30" />
        </label>
      </div>

      {['kling', 'seedance'].includes(provider) && (
        <>
          <div className="mb-4 mt-8 flex items-end justify-between gap-3">
            <div><h3 className="text-xl font-black">Ready in Veyrnox · {visibleLocal.length}</h3><p className="mt-1 text-xs text-vx-fg-muted">These recipes have local previews and open in Veyrnox.</p></div>
          </div>
          {visibleLocal.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <ReadyCard key={item.id} item={item} badge="Ready" />)}</ul>
            : needle ? <Empty query={query} />
              : <p className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">No locally runnable recipes yet. Browse the live provider index below.</p>}
          <div className="mb-4 mt-12">
            <h3 className="text-xl font-black">Live provider index{remote[provider] ? ` · ${remote[provider].total}` : ''}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">Complete metadata from CRUN. Provider credits are upstream costs, not a Veyrnox price. Generation stays disabled until each effect has Veyrnox pricing and a paid proof.</p>
          </div>
          {error[provider] && <div role="status" className="mb-4 rounded-xl border border-vx-warning/40 bg-vx-warning/5 px-4 py-3 text-sm text-vx-fg-body">{error[provider]} <button type="button" className="ms-2 min-h-11 font-bold text-vx-accent underline" onClick={() => loadRemote(provider, 1)}>Retry</button></div>}
          {!remote[provider] && loading === provider ? <p role="status" className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">Loading the live {info.label} index…</p>
            : visibleRemote.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleRemote.map(item => <ProviderCard key={item.id} item={item} provider={info.label} />)}</ul>
              : remote[provider] && <Empty query={query} />}
          {remote[provider] && remote[provider].templates.length < remote[provider].total && (
            <button type="button" disabled={loading === provider} onClick={() => loadRemote(provider, remote[provider].page + 1)} className="vx-press mt-6 min-h-11 rounded-full border border-vx-border px-6 text-sm font-bold hover:border-vx-accent disabled:opacity-50">
              {loading === provider ? 'Loading…' : `Load 50 more · ${remote[provider].templates.length} of ${remote[provider].total}`}
            </button>
          )}
        </>
      )}

      {provider === 'veo' && (visibleLocal.length ? <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <VeoCard key={item.id} item={item} onUse={useVeo} />)}</ul> : <div className="mt-8"><Empty query={query} /></div>)}
      {provider === 'suno' && (visibleLocal.length ? <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{visibleLocal.map(item => <SunoCard key={item.id} item={item} />)}</ul> : <div className="mt-8"><Empty query={query} /></div>)}
    </section>
  );
}
