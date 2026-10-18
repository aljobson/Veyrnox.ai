'use client';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider.jsx';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../_components/Button';
import { CinemaShare } from './CinemaShare';
import { CinemaPoster } from './CinemaPoster';
import { cinemaDescription } from '../_lib/cinemaDescription';
import { editorialSeriesCards } from './editorialSeries';
const labels = (t) => ({ all: t("cinema.discovery.nowShowing"), series: t("cinema.discovery.publishedSeries"), voting: t("cinema.discovery.openCompetitions") });
export function CinemaDiscovery({ mode = 'all', onAvailability }) {
  // Switching tabs remounts the inventory: a late response cannot populate another tab.
  return <Inventory key={mode} mode={mode} onAvailability={onAvailability} />;
}
function Inventory({ mode, onAvailability }) {
  const { t, href: localize, locale } = useI18n();

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
      setTitles(previous => cursor ? [...new Map([...previous, ...received].map(item => [item.id, item])).values()] : received);
      setCategories(data.categories); setNext(data.next); setState('ready'); onAvailability?.(true);
    } catch (error) {
      if (seq !== generation.current) return;
      if (cursor) { setMoreError(true); setState('ready'); }
      else if (mode === 'series') {
        const published = editorialSeriesCards(slug);
        setTitles(published); setState('ready'); onAvailability?.(published.length > 0);
      } else { setState(error.closed ? 'closed' : 'error'); if (error.closed) onAvailability?.(false); }
    } finally { if (seq === generation.current) pending.current = false; }
  }, [mode, onAvailability]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  const choose = slug => { filter.current = slug; setCategory(slug); void load(null, slug); };
  return <section className="py-10" aria-labelledby="discovery-title" aria-busy={state === 'loading' || state === 'more'}>
    <h2 id="discovery-title" className="text-2xl font-extrabold">{labels(t)[mode]}</h2>
    {mode === 'voting' && <p className="mt-3 max-w-2xl text-sm text-vx-fg-body">{t("cinema.discovery.exploreTitlesEligibleForAnOpen")}</p>}
    {categories.length > 0 && state !== 'closed' && <nav aria-label={t("cinema.discovery.cinemaCategories")} className="mt-4 flex gap-2 overflow-x-auto pb-2">
      {[['', t("cinema.discovery.allCategories")], ...categories.map(c => [c.slug, tOr(t, `cinema.category.${c.slug}`, c.label || c.slug)])].map(([slug, label]) => <button key={slug || 'all'} type="button" aria-pressed={category === slug} onClick={() => choose(slug)}
        className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent ${category === slug ? 'bg-vx-accent text-vx-accent-ink' : 'border border-vx-border text-vx-fg-muted hover:bg-vx-panel'}`}>{label}</button>)}
    </nav>}
    {state === 'loading' && <p role="status" className="mt-5 text-vx-fg-muted">{t("cinema.discovery.loadingCinemaTitles")}</p>}
    {state === 'closed' && <p role="status" className="mt-5 text-vx-fg-muted">{mode === 'voting' ? t("cinema.discovery.communityVotingIsNotOpenYet") : t("cinema.discovery.socialCinemaViewingIsNotOpen")}</p>}
    {state === 'error' && <div className="mt-5"><p role="alert">{t("cinema.discovery.couldNotLoadCinemaTitlesPlease")}</p><Button variant="ghost" className="mt-3" onClick={() => load()}>{t("cinema.discovery.retryTitles")}</Button></div>}
    {(state === 'ready' || state === 'more') && titles.length === 0 && <p role="status" className="mt-5 text-vx-fg-muted">{tOr(t, `cinema.discovery.empty.${mode}${category ? 'Category' : ''}`, t('cinema.discovery.empty.all'))}</p>}
    <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {titles.map((item, index) => {
        const href = item.series_slug ? `/social-cinema/series/${item.series_slug}` : item.content_type === 'EPISODE' ? `/social-cinema/watch/${item.id}?title_id=${item.root_id}` : `/social-cinema/title/${item.id}`;
        return <li key={item.id} className="flex flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-base/60" data-testid={`cinema-title-${item.id}`}>
          <CinemaPoster id={item.poster_id || item.id} src={item.poster_src} title={item.title} href={localize(href)} eager={index === 0} />
          <div className="flex flex-1 flex-col p-5">
          <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">{tOr(t, `cinema.type.${item.content_type}`, item.content_type)}{item.content_type === 'SERIES' ? t('cinema.discovery.episodes', { count: item.episode_count }) : item.duration_seconds ? t('cinema.discovery.duration', { n: Math.max(1, Math.round(item.duration_seconds / 60)) }) : ''}</p>
          <h3 className="mt-2 text-xl font-bold wrap-break-word"><Link href={localize(href)} className="hover:underline">{item.title}</Link></h3>
          {item.series_title && <Link href={localize(`/social-cinema/title/${item.root_id}`)} className="mt-1 text-sm underline">{item.series_title}</Link>}
          <p className="mt-1 text-sm text-vx-fg-muted">{item.display_name}{item.categories.length ? ` · ${item.categories.map(slug => tOr(t, `cinema.category.${slug}`, categories.find(c => c.slug === slug)?.label || slug)).join(', ')}` : ''}</p>
          {cinemaDescription(item.synopsis) && <p className="mt-3 line-clamp-2 text-sm text-vx-fg-body wrap-break-word">{cinemaDescription(item.synopsis)}</p>}
          {item.competitions.length > 0 && <ul className="mt-4 space-y-2 text-sm">{item.competitions.map(c => <li key={c.id}><span className="font-bold">{c.name}</span><br />{c.qualified_votes} {t("cinema.discovery.qualifiedVotesCloses")}{' '}{new Date(c.ends_at).toLocaleString(localeTag(locale))}</li>)}</ul>}
          <Link href={localize(href)} className="mt-4 inline-flex self-start rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-vx-accent-ink">{mode === 'voting' ? t("cinema.discovery.watchAndVote") : t("cinema.discovery.watch")}</Link>
          <CinemaShare id={item.id} title={item.title} episode={item.content_type === 'EPISODE'} />
          </div>
        </li>;
      })}
    </ul>
    {moreError && <p role="alert" className="mt-4">{t("cinema.discovery.couldNotLoadMoreTitlesYour")}</p>}
    {next && <Button variant="ghost" className="mt-6" disabled={state === 'more'} onClick={() => load(next)}>{state === 'more' ? t("cinema.discovery.loadingMore") : moreError ? t("cinema.discovery.retryMoreTitles") : t("cinema.discovery.showMoreTitles")}</Button>}
  </section>;
}
