'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../_components/Button';
import { CinemaShare } from './CinemaShare';
import { CinemaPoster } from './CinemaPoster';
import { cinemaDescription } from '../_lib/cinemaDescription';
import { editorialSeriesCards } from './editorialSeries';
const labels = { all: 'Now showing', series: 'Published series', voting: 'Open competitions' };
export function CinemaDiscovery({ mode = 'all', onAvailability }) {
  // Switching tabs remounts the inventory: a late response cannot populate another tab.
  return <Inventory key={mode} mode={mode} onAvailability={onAvailability} />;
}
function Inventory({ mode, onAvailability }) {
  const [titles, setTitles] = useState([]), [categories, setCategories] = useState([]), [category, setCategory] = useState('');
  const [state, setState] = useState('loading'), [next, setNext] = useState(null), [moreError, setMoreError] = useState(false);
  const generation = useRef(0), pending = useRef(false), filter = useRef('');
  const load = useCallback(async (cursor = null, slug = filter.current) => {
    if (cursor && pending.current) return;
    const seq = ++generation.current;
    pending.current = true;
    setState(cursor ? 'more' : 'loading'); setMoreError(false);
    if (!cursor) { setTitles([]); setNext(null); }
    try {
      const params = new URLSearchParams({ mode });
      if (slug) params.set('category', slug);
      if (cursor) { params.set('before', cursor.at); params.set('before_id', cursor.id); }
      const response = await fetch(`/api/cinema/discovery?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (seq !== generation.current) return;
      if (!response.ok) throw Object.assign(Error('failed'), { closed: response.status === 503 && ['viewing_not_open', 'voting_not_open'].includes(data.error) });
      if (!Array.isArray(data.titles) || !Array.isArray(data.categories) || data.mode !== mode) throw Error('bad response');
      const received = mode === 'series' && !cursor ? [...editorialSeriesCards(slug), ...data.titles] : data.titles;
      setTitles(previous => cursor ? [...new Map([...previous, ...received].map(t => [t.id, t])).values()] : received);
      setCategories(data.categories); setNext(data.next); setState('ready'); onAvailability?.(true);
    } catch (error) {
      if (seq !== generation.current) return;
      if (cursor) { setMoreError(true); setState('ready'); }
      else { setState(error.closed ? 'closed' : 'error'); if (error.closed) onAvailability?.(false); }
    } finally { if (seq === generation.current) pending.current = false; }
  }, [mode, onAvailability]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  const choose = slug => { filter.current = slug; setCategory(slug); void load(null, slug); };
  return <section className="py-10" aria-labelledby="discovery-title" aria-busy={state === 'loading' || state === 'more'}>
    <h2 id="discovery-title" className="text-2xl font-extrabold">{labels[mode]}</h2>
    {mode === 'voting' && <p className="mt-3 max-w-2xl text-sm text-vx-fg-body">Explore titles eligible for an open competition. Open a title to watch and vote. Voting is free, with one vote per title in each competition. Counts exclude votes awaiting review.</p>}
    {categories.length > 0 && state !== 'closed' && <nav aria-label="Cinema categories" className="mt-4 flex gap-2 overflow-x-auto pb-2">
      {[['', 'All categories'], ...categories.map(c => [c.slug, c.label])].map(([slug, label]) => <button key={slug || 'all'} type="button" aria-pressed={category === slug} onClick={() => choose(slug)}
        className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${category === slug ? 'bg-vx-accent text-vx-accent-ink' : 'border border-vx-border text-vx-fg-muted hover:bg-vx-panel'}`}>{label}</button>)}
    </nav>}
    {state === 'loading' && <p role="status" className="mt-5 text-vx-fg-muted">Loading Cinema titles…</p>}
    {state === 'closed' && <p role="status" className="mt-5 text-vx-fg-muted">{mode === 'voting' ? 'Community voting is not open yet.' : 'Social Cinema viewing is not open yet.'}</p>}
    {state === 'error' && <div className="mt-5"><p role="alert">Could not load Cinema titles. Please retry.</p><Button variant="ghost" className="mt-3" onClick={() => load()}>Retry titles</Button></div>}
    {(state === 'ready' || state === 'more') && titles.length === 0 && <p role="status" className="mt-5 text-vx-fg-muted">{mode === 'voting' ? 'No eligible titles in open competitions' : mode === 'series' ? 'No series are published' : 'No titles are published'}{category ? ' in this category yet.' : ' yet.'}</p>}
    <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {titles.map(t => {
        const href = t.series_slug ? `/social-cinema/series/${t.series_slug}` : t.content_type === 'EPISODE' ? `/social-cinema/watch/${t.id}?title_id=${t.root_id}` : `/social-cinema/title/${t.id}`;
        return <li key={t.id} className="flex flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-base/60" data-testid={`cinema-title-${t.id}`}>
          <CinemaPoster id={t.poster_id || t.id} title={t.title} href={href} />
          <div className="flex flex-1 flex-col p-5">
          <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">{t.content_type}{t.content_type === 'SERIES' ? ` · ${t.episode_count} episodes` : t.duration_seconds ? ` · ${Math.max(1, Math.round(t.duration_seconds / 60))} min` : ''}</p>
          <h3 className="mt-2 text-xl font-bold wrap-break-word"><Link href={href} className="hover:underline">{t.title}</Link></h3>
          {t.series_title && <Link href={`/social-cinema/title/${t.root_id}`} className="mt-1 text-sm underline">{t.series_title}</Link>}
          <p className="mt-1 text-sm text-vx-fg-muted">{t.display_name}{t.categories.length ? ` · ${t.categories.join(', ')}` : ''}</p>
          {cinemaDescription(t.synopsis) && <p className="mt-3 line-clamp-2 text-sm text-vx-fg-body wrap-break-word">{cinemaDescription(t.synopsis)}</p>}
          {t.competitions.length > 0 && <ul className="mt-4 space-y-2 text-sm">{t.competitions.map(c => <li key={c.id}><span className="font-bold">{c.name}</span><br />{c.qualified_votes} qualified votes · Closes {new Date(c.ends_at).toLocaleString()}</li>)}</ul>}
          <Link href={href} className="mt-4 inline-flex self-start rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-vx-accent-ink">{mode === 'voting' ? 'Watch and vote' : 'Watch'}</Link>
          <CinemaShare id={t.id} title={t.title} episode={t.content_type === 'EPISODE'} />
          </div>
        </li>;
      })}
    </ul>
    {moreError && <p role="alert" className="mt-4">Could not load more titles. Your current list is still available.</p>}
    {next && <Button variant="ghost" className="mt-6" disabled={state === 'more'} onClick={() => load(next)}>{state === 'more' ? 'Loading more…' : moreError ? 'Retry more titles' : 'Show more titles'}</Button>}
  </section>;
}
