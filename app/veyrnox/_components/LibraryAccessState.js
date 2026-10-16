'use client';

import { AppNav } from './NavBar';
import { Main } from './Main';

export function LibraryAccessState({ loading }) {
  return (
    <div className="min-h-dvh">
      <AppNav active="library" readAccount={false} />
      <Main className="max-w-[1400px] mx-auto px-4 sm:px-8 py-16">
        {loading ? <p role="status" className="text-vx-fg-body">Loading your library…</p> : <>
          <h1 className="vx-display text-[36px] sm:text-[48px]">Sign in to view your library</h1>
          <p className="mt-4 text-vx-fg-body">Your generations are saved to your account. Sign in to see your jobs and downloads.</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}
            className="vx-press mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold">
            Sign in
          </button>
        </>}
      </Main>
    </div>
  );
}
