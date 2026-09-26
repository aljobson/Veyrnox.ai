'use client';

import Link from 'next/link';
import { CreatorApplication } from './CreatorApplication';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../_components/Button';
import { getSession, onSessionChange } from '../../lib/authClient';
import { gatewayFetch } from '../_lib/gateway';

const identity = () => getSession()?.user?.id || '';
const noIdentity = () => '';

// Published titles, once viewing is open; the marketing sections stay until then.
function Catalogue() {
  const [titles, setTitles] = useState(null);
  const [state, setState] = useState('loading');
  const [next, setNext] = useState(null);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const load = async (before, slug = category) => {
    try {
      const params = new URLSearchParams();
      if (before) params.set('before', before);
      if (slug) params.set('category', slug);
      const r = await fetch(`/api/cinema/titles${params.size ? `?${params}` : ''}`);
      if (!r.ok) { setState(r.status === 503 ? 'closed' : 'error'); return; }
      const data = await r.json();
      setTitles((prev) => (before && prev ? [...prev, ...data.titles] : data.titles)); setNext(data.next); setCategories(data.categories || []); setState('ready');
    } catch { setState('error'); }
  };
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (state !== 'ready') return null;
  return <section className="mt-12" aria-labelledby="catalogue-title">
    <h2 id="catalogue-title" className="text-2xl font-extrabold">Now showing</h2>
    {categories.length > 0 && <nav aria-label="Categories" className="mt-4 flex gap-2 overflow-x-auto pb-2">
      {[['', 'All'], ...categories.map((c) => [c.slug, c.label])].map(([slug, label]) => <button key={slug || 'all'} type="button" aria-pressed={category === slug}
        onClick={() => { setCategory(slug); load(null, slug); }}
        className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${category === slug ? 'bg-vx-accent text-vx-accent-ink' : 'border border-vx-border text-vx-fg-muted hover:bg-vx-panel'}`}>{label}</button>)}
    </nav>}
    {titles.length === 0 ? <p className="mt-4 text-vx-fg-muted">{category ? 'Nothing in this category yet.' : 'Nothing is published yet. The first stories are on their way.'}</p> : <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {titles.map((t) => <li key={t.id} className="flex flex-col rounded-2xl border border-vx-border bg-vx-base/60 p-5">
        <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">{t.content_type}{t.content_type === 'SERIES' ? ` · ${t.episode_count} episodes` : t.duration_seconds ? ` · ${Math.max(1, Math.round(t.duration_seconds / 60))} min` : ''}</p>
        <h3 className="mt-2 text-xl font-bold break-words"><Link href={`/social-cinema/title/${t.id}`} className="hover:underline">{t.title}</Link></h3>
        <p className="mt-1 text-sm text-vx-fg-muted">{t.display_name}{t.categories?.length ? ` · ${t.categories.join(', ')}` : ''}</p>
        <p className="mt-3 line-clamp-3 text-sm text-vx-fg-body break-words">{t.synopsis}</p>
        <Link href={`/social-cinema/title/${t.id}`} className="mt-4 inline-flex self-start rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-vx-accent-ink">Watch</Link>
      </li>)}
    </ul>}
    {next && <Button variant="secondary" className="mt-6" onClick={() => load(next)}>Show more</Button>}
  </section>;
}

const sections = [
  ['For You', 'The first stories are still ahead.', 'The vertical episode feed is being built. Published stories will appear here when viewing opens.'],
  ['Series', 'Every episode starts with a story.', 'Creator series and episode publishing are in development. You can already make video in the Studio.'],
  ['Vote', 'Your next favourite deserves a voice.', 'Community voting will open with eligible episodes. There are no live competitions yet.'],
  ['Winners', 'The spotlight is waiting.', 'Weekly winners will appear after voting, ranking and moderation are ready.'],
];

export function SocialCinema() {
  const [section, setSection] = useState(0);
  const account = useSyncExternalStore(onSessionChange, identity, noIdentity);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    try { setPreview(localStorage.getItem('veyrnox_social_cinema') === 'true'); } catch {}
  }, []);
  return <main id="main" className="mx-auto max-w-[1100px] px-4 py-10 pb-40 sm:px-8 sm:py-16 sm:pb-32">
    <header className="max-w-2xl">
      <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">SOCIAL CINEMA · IN DEVELOPMENT</p>
      <h1 className="text-4xl font-black leading-tight sm:text-6xl">Stories worth<br />coming back for.</h1>
      <p className="mt-6 text-lg leading-relaxed text-vx-fg-body">Short episodes. Ongoing series. An audience with a say in what happens next.</p>
      <p className="mt-3 text-sm text-vx-fg-muted">We’re building Social Cinema on Veyrnox.ai. Watching, publishing and voting are not open yet.</p>
    </header>
    <nav aria-label="Social Cinema" className="mt-10 flex gap-1 overflow-x-auto border-b border-vx-border pb-3">
      {sections.map(([label], index) => <button key={label} type="button"
        aria-current={section === index ? 'page' : undefined} onClick={() => setSection(index)}
        className={`shrink-0 rounded-full px-5 py-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${section === index ? 'bg-vx-accent text-vx-accent-ink' : 'text-vx-fg-muted hover:bg-vx-panel'}`}>{label}</button>)}
    </nav>
    <section aria-live="polite" className="grid gap-8 py-10 sm:grid-cols-[1fr_240px] sm:items-center">
      <div><p className="font-vx-mono text-xs text-vx-fg-muted">COMING NEXT</p>
        <h2 className="mt-3 text-2xl font-extrabold">{sections[section][1]}</h2>
        <p className="mt-4 max-w-lg leading-relaxed text-vx-fg-body">{sections[section][2]}</p>
        <Link href="/app/create?model=wan-2.5-kie" className="mt-6 inline-flex rounded-full border border-vx-border px-5 py-3 text-sm font-bold hover:border-vx-accent">Make a video in Studio ↗</Link>
      </div>
      <div aria-hidden="true" className="hidden aspect-[3/4] items-center justify-center rounded-3xl border border-vx-border bg-vx-panel sm:flex">
        <div className="text-center"><span className="text-5xl text-vx-accent">▷</span><p className="mt-6 font-vx-mono text-xs leading-loose text-vx-fg-muted">WATCH<br />VOTE<br />RETURN</p></div>
      </div>
    </section>
    <Catalogue />
    {preview && <section className="border-t border-vx-border pt-8" aria-labelledby="profile-title">
      <h2 id="profile-title" className="text-xl font-extrabold">Your Social Cinema profile</h2>
      {account ? <Profile key={account} /> : <div className="mt-4"><p className="mb-4 text-vx-fg-body">Use your Veyrnox.ai account to get started.</p><Button onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</Button></div>}
    </section>}
  </main>;
}

function Profile() {
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef(null);
  useEffect(() => {
    let active = true;
    setState('loading');
    gatewayFetch('/social-cinema/profile').then(data => {
      if (active) { setProfile(data.profile); setState('ready'); }
    }).catch(e => {
      if (active) { setError(message(e.code)); setState(e.code === 'profiles_not_open' ? 'closed' : 'error'); }
    });
    return () => { active = false; };
  }, [attempt]);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({ username: form.get('username'), display_name: form.get('display_name'), bio: form.get('bio') });
    if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
    setState('saving'); setError('');
    try {
      await gatewayFetch('/social-cinema/profile', { method: 'POST', body, headers: { 'idempotency-key': request.current.key } });
      setAttempt(n => n + 1);
    } catch (e) {
      if (e.code === 'profile_exists') { setAttempt(n => n + 1); return; }
      setError(message(e.code)); setState('ready');
    }
  }
  if (state === 'loading') return <p role="status" className="mt-4 text-vx-fg-muted">Loading your profile…</p>;
  if (state === 'closed' || state === 'error') return <div className="mt-4"><p role="status">{error}</p>{state === 'error' && <Button className="mt-4" onClick={() => setAttempt(n => n + 1)}>Try again</Button>}</div>;
  if (profile) return <><div className="mt-5 rounded-2xl border border-vx-border p-6"><h3 className="text-xl font-bold">{profile.display_name}</h3><p className="mt-1 text-vx-accent">@{profile.username}</p><p className="mt-4 whitespace-pre-wrap break-words text-vx-fg-body">{profile.bio}</p><p className="mt-5 text-sm text-vx-fg-muted">Your profile is saved. Publishing and voting will open in a later release.</p></div><CreatorApplication />{profile.role === 'creator' && <Link href="/social-cinema/creator" className="mt-6 inline-flex rounded-full border border-vx-border px-5 py-3 font-bold text-vx-accent">Open creator workspace →</Link>}</>;
  const input = 'mt-2 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-vx-fg focus:outline focus:outline-2 focus:outline-vx-accent';
  return <form onSubmit={submit} className="mt-4 max-w-lg space-y-5">
    <p className="text-sm text-vx-fg-body">Your username, display name and bio are intended for your public profile. Your email stays private. Choose carefully: profile editing is not available yet.</p>
    <label className="block text-sm font-semibold" htmlFor="cinema-username">Username<input id="cinema-username" name="username" required minLength={3} maxLength={30} pattern="[a-z][a-z0-9_]{2,29}" autoCapitalize="none" autoCorrect="off" className={input} aria-describedby="username-help" /></label>
    <p id="username-help" className="text-xs text-vx-fg-muted">3–30 lowercase letters, numbers or underscores. Start with a letter.</p>
    <label className="block text-sm font-semibold" htmlFor="cinema-name">Display name<input id="cinema-name" name="display_name" required maxLength={80} className={input} /></label>
    <label className="block text-sm font-semibold" htmlFor="cinema-bio">Bio <span className="font-normal">(optional)</span><textarea id="cinema-bio" name="bio" maxLength={500} rows={3} className={input} /></label>
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    <Button type="submit" disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Create my profile'}</Button>
  </form>;
}
function message(code) {
  return ({ account_not_active: 'Your Cinema account is restricted. Contact support for help.', profiles_not_open: 'Profile registration is not open yet. Please check back soon.', username_unavailable: 'That username is taken. Try another.',
    invalid_profile: 'Check your username and display name, then try again.', rate_limited: 'Too many requests. Wait a minute, then try again.',
    idempotency_conflict: 'This attempt changed. Reload to check your saved profile before trying again.' })[code]
    || 'We could not load or save your profile. Please try again.';
}
