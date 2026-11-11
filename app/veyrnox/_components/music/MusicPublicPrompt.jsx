'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getSession } from '../../../lib/authClient';
import { nextMusicPrompt } from './musicWriting';

export const MUSIC_PUBLIC_DRAFT_KEY = 'veyrnox.music.public-draft.v1';

export function MusicPublicPrompt({ available = false }) {
  const router = useRouter();
  const [direction, setDirection] = useState('');
  const prompt = direction.trim();

  function continueToStudio(event) {
    event.preventDefault();
    if (!prompt) return;
    sessionStorage.setItem(MUSIC_PUBLIC_DRAFT_KEY, JSON.stringify({ prompt, saved_at: Date.now() }));
    const returnTo = '/app/music/create?from=public';
    if (getSession()?.access_token) {
      router.push(returnTo);
      return;
    }
    window.dispatchEvent(new CustomEvent('veyrnox:auth-required', {
      detail: { mode: 'sign_up', returnTo },
    }));
  }

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="font-vx text-xl font-black tracking-tight">Veyrnox Music</Link>
        <Link href="/app/music/library" className="min-h-11 rounded-full border border-vx-border px-4 py-3 text-sm font-bold text-vx-fg-body hover:border-vx-border-boost">Open Library</Link>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="mx-auto grid min-h-[70dvh] max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Original sound, private first</p>
            <h1 className="mt-4 max-w-3xl font-vx text-5xl font-black tracking-tight sm:text-6xl">Start with the feeling, not the settings.</h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-vx-fg-body">Describe an instrumental direction now. Your words stay in this browser until you sign in, review the exact credit quote, and explicitly confirm two private versions.</p>
            <ol aria-label="How private music creation works" className="mt-8 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ['1', 'Describe', 'Write the mood, rhythm and texture.'],
                ['2', 'Review', 'See the exact price before credits move.'],
                ['3', 'Compare', 'Receive two independently tracked versions.'],
              ].map(([number, title, body]) => <li key={number} className="rounded-2xl border border-vx-border bg-vx-panel p-4"><span className="font-vx-mono text-xs text-vx-accent">{number}</span><strong className="mt-2 block">{title}</strong><span className="mt-1 block text-xs leading-5 text-vx-fg-muted">{body}</span></li>)}
            </ol>
          </div>
          <form onSubmit={continueToStudio} className="rounded-3xl border border-vx-border bg-vx-panel p-5 shadow-2xl sm:p-7">
            <label className="block">
              <span className="flex items-center justify-between gap-4 text-sm font-bold"><span>What should it feel like?</span><span className="font-vx-mono text-xs text-vx-fg-faint">{direction.length}/500</span></span>
              <textarea value={direction} onChange={(event) => setDirection(event.target.value)} maxLength={500} rows={8} autoFocus placeholder="A weightless midnight pulse with brushed drums, warm bass and distant glass harmonics" className="mt-3 w-full resize-y rounded-2xl border border-vx-border-boost bg-vx-base px-4 py-4 text-base leading-7 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
            </label>
            <button type="button" onClick={() => setDirection((current) => nextMusicPrompt(current))} className="mt-3 min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-body hover:border-vx-border-boost">Try a direction</button>
            <button type="submit" disabled={!prompt || !available} className="mt-5 min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{available ? 'Continue to private creation' : 'Music early access is paused'}</button>
            <p className="mt-3 text-center text-xs leading-5 text-vx-fg-muted">No provider request or credit spend happens on this page. Sign-in is required before a server quote.</p>
          </form>
        </section>
      </main>
    </div>
  );
}
