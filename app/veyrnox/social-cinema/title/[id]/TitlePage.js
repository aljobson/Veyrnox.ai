'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../../_components/Button';
import { getSession, onSessionChange } from '../../../../lib/authClient';
import { gatewayFetch, notifyBalanceChanged } from '../../../_lib/gateway';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const labels = { FILM: 'Film', SHORT: 'Short', TRAILER: 'Trailer', SERIES: 'Series' };
const minutes = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');
// The wording the Unlock consent version stands for. A change needs a new version on both sides.
const CONSENT_TEXT = 'Unlock now and add it to my account for good. I understand this spends credits straight away and that my right to cancel ends once I press play.';

export function TitlePage({ id }) {
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [title, setTitle] = useState(null);
  const [state, setState] = useState('loading');
  const [consentVersion, setConsentVersion] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!UUID.test(id)) { setState('missing'); return; }
    setState('loading');
    try {
      const data = account ? await gatewayFetch(`/cinema/titles/${id}`) : await fetch(`/api/cinema/titles/${id}`).then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error('failed'), { status: r.status }))));
      setTitle(data.title); setState('ready');
      if (account) { try { setConsentVersion((await gatewayFetch(`/cinema/entitlement?content_id=${id}`)).consent_version); } catch { /* the consent version rides on any entitlement read; the first unlock will ask again */ } }
    } catch (err) { setState(err?.status === 404 || err?.status === 400 ? 'missing' : err?.status === 503 ? 'closed' : 'error'); }
  }, [id, account]);
  useEffect(() => { load(); }, [load]);

  const unlock = async (item) => {
    if (!account) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
    setBusy(item.id); setNotice('');
    try {
      let version = consentVersion;
      if (!version) version = (await gatewayFetch(`/cinema/entitlement?content_id=${item.id}`)).consent_version;
      const r = await gatewayFetch('/cinema/unlocks', { method: 'POST', body: JSON.stringify({ content_id: item.id, consent_version: version }) });
      notifyBalanceChanged();
      setNotice(r.access === 'unlocked' ? `Unlocked. ${r.balance_after != null ? `${r.balance_after} credits left.` : ''}` : 'This one is free.');
      await load();
    } catch (err) {
      setNotice(err?.code === 'insufficient_credits' ? 'Not enough credits. Top up from Credits & billing, or get a Cinema Pass.' : err?.code === 'account_frozen' ? 'Your account is paused. Contact support.' : 'Could not unlock right now. Try again in a moment.');
    } finally { setBusy(''); }
  };

  if (state === 'loading') return <main id="main" className="mx-auto max-w-[1000px] px-4 py-16 sm:px-8"><p role="status" className="text-vx-fg-muted">Loading…</p></main>;
  if (state !== 'ready') return <main id="main" className="mx-auto max-w-[1000px] px-4 py-16 sm:px-8"><p role="status">{state === 'missing' ? 'This title is not available.' : state === 'closed' ? 'Social Cinema viewing is not open yet.' : 'Could not load this title. Try again in a moment.'}</p><Link href="/social-cinema" className="mt-6 inline-block underline">Back to Social Cinema</Link></main>;

  const playable = (item) => ['free', 'unlocked', 'pass'].includes(item.access);
  const Item = ({ item, label }) => <li className="flex flex-wrap items-center justify-between gap-3 py-4">
    <div className="min-w-0 flex-1">
      <p className="font-bold break-words">{label}{item.title}</p>
      {item.synopsis && <p className="mt-1 line-clamp-2 text-sm text-vx-fg-body break-words">{item.synopsis}</p>}
      <p className="mt-1 font-vx-mono text-xs text-vx-fg-muted">{minutes(item.duration_seconds)}{item.access === 'free' ? ' · Free' : item.access === 'unlocked' ? ' · Unlocked' : item.access === 'pass' ? ' · Cinema Pass' : item.reason === 'pass_ceiling' ? ' · Pass limit reached this month' : ''}</p>
    </div>
    {playable(item) ? <Link href={`/social-cinema/watch/${item.id}`} className="rounded-full bg-vx-accent px-5 py-2 text-sm font-bold text-vx-accent-ink">Play</Link>
      : <Button size="sm" disabled={busy === item.id || (account && !agreed)} onClick={() => unlock(item)}>{account ? `Unlock for ${item.credits} credits` : 'Sign in to unlock'}</Button>}
  </li>;
  const locked = title.content_type === 'SERIES' ? title.seasons.some((s) => s.episodes.some((e) => e.access === 'locked')) : title.access === 'locked';

  return <main id="main" className="mx-auto max-w-[1000px] px-4 py-10 pb-40 sm:px-8 sm:py-16 sm:pb-32">
    <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">SOCIAL CINEMA · {labels[title.content_type]?.toUpperCase()}</p>
    <h1 className="text-4xl font-black leading-tight break-words sm:text-5xl">{title.title}</h1>
    <p className="mt-3 text-vx-fg-muted">by <Link href={`/social-cinema`} className="underline">{title.creator?.display_name}</Link> · {title.language}{title.ai_disclosures?.length ? ` · AI: ${title.ai_disclosures.join(', ').replaceAll('_', ' ')}` : ''}</p>
    {title.synopsis && <p className="mt-6 max-w-2xl leading-relaxed text-vx-fg-body whitespace-pre-wrap break-words">{title.synopsis}</p>}
    {notice && <p role="status" aria-live="polite" className="mt-6 rounded-lg border border-vx-border bg-vx-base/60 px-4 py-3 text-sm">{notice}</p>}
    {locked && account && <div className="mt-8 rounded-2xl border border-vx-border p-5">
      <label className="flex items-start gap-3 text-sm text-vx-fg-body"><input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>{CONSENT_TEXT}</span></label>
      <p className="mt-3 text-sm text-vx-fg-muted">Or watch everything with a <Link href="/social-cinema/pass" className="underline">Cinema Pass</Link>.</p>
    </div>}
    {title.content_type === 'SERIES' ? title.seasons.map((s) => <section key={s.id} className="mt-10" aria-labelledby={`season-${s.id}`}>
      <h2 id={`season-${s.id}`} className="text-xl font-extrabold">Season {s.position}{s.title && s.title !== title.title ? `: ${s.title}` : ''}</h2>
      <ul className="mt-2 divide-y divide-vx-border border-y border-vx-border">{s.episodes.map((e) => <Item key={e.id} item={e} label={`${e.position}. `} />)}</ul>
    </section>) : <ul className="mt-10 border-y border-vx-border"><Item item={{ ...title }} label="" /></ul>}
    <p className="mt-10 text-sm"><Link href="/social-cinema" className="underline">Back to Social Cinema</Link></p>
  </main>;
}
