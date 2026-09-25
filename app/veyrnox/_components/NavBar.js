'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Logo } from './Logo';
import { NavAuthButtons } from './NavAuthButtons';
import { MobileMenu } from './MobileMenu';
import { SiteSearch } from './SiteSearch';
import { ThemeToggle } from './ThemeToggle';
import { gatewayFetch, GatewayError } from '../_lib/gateway';
import { getSession, onSessionChange } from '../../lib/authClient';
import { accountLabel } from '../_lib/account';

// Marketing site nav (Home / Gallery / Pricing).
export function MarketingNav() {
  // Rewrites serve /veyrnox/* at /*, so the browser path has no prefix.
  const path = usePathname().replace(/^\/veyrnox/, '') || '/';
  const items = [
    { href: '/',         label: 'Home' },
    { href: '/presets', label: 'Gallery' },
    { href: '/social-cinema', label: 'Social Cinema' },
    { href: '/pricing', label: 'Pricing' },
  ];
  return (
    <div data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link href="/" aria-label="Veyrnox.ai — home" className="flex items-center gap-2.5 shrink-0">
        <Logo wordmark />
      </Link>
      <nav aria-label="Primary" className="hidden lg:flex gap-1.5 text-sm font-semibold">
        {items.map((it) => {
          const target = it.href.replace(/^\/veyrnox/, '') || '/';
          const active = target === '/' ? path === '/' : path.startsWith(target);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={`px-4 py-2 rounded-full transition-colors ${
                active ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-2 shrink-0">
        <SiteSearch className="hidden sm:inline-flex" />
        <ThemeToggle className="hidden sm:inline-flex" />
        <NavAuthButtons />
        {/* Below sm the links above are hidden — without this the only way
            off this page was the browser back button. */}
        <MobileMenu items={items} className="lg:hidden" />
      </div>
    </div>
  );
}

// Web app nav (Explore / Create / Library). Signed in, the right-hand side
// says who you are, what you can spend and how much you have made; signed
// out it is a single sign-in button and no figures at all.
// If `balance` prop is provided the parent owns it; otherwise the pill
// self-fetches and subscribes to veyrnox:balance-changed.
export function AppNav({ balance, active = 'explore' }) {
  const items = [
    { key: 'explore', href: '/app',         label: 'Explore' },
    { key: 'create',  href: '/app/create',  label: 'Create' },
    { key: 'library', href: '/app/library', label: 'Library' },
  ];
  // One server read for all three figures: who you are, the balance and
  // the true asset count for the account (not this browser's history).
  // A generation both spends credits and stores an asset, so the existing
  // veyrnox:balance-changed is already the moment all of it moved.
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await gatewayFetch('/account'));
    } catch (e) {
      // Signed out: drop the figures with the session. Any other failure
      // keeps the last good read — a stale number beats a wrong one, and
      // an unanswered read renders "—", never a spinner.
      if (e instanceof GatewayError && e.status === 401) setSummary(null);
    }
  }, []);
  useEffect(() => {
    loadSummary();
    const onBal = () => loadSummary();
    window.addEventListener('veyrnox:balance-changed', onBal);
    return () => window.removeEventListener('veyrnox:balance-changed', onBal);
  }, [loadSummary]);

  // Who is signed in. The session in localStorage is the gate — it needs no
  // network, so the sign-in button is never wrong while /account is in
  // flight — and null until mount on both sides so the server and client
  // markup match. It also already holds the display name: Google puts one
  // in user_metadata, and public.users has no such column. The endpoint
  // only supplies the email, for the sessions that carry none.
  const [session, setSession] = useState(null);
  useEffect(() => {
    setSession(getSession());
    return onSessionChange(setSession);
  }, []);
  const account = accountLabel(session, summary?.email || '');

  const assets = summary?.assets ?? null;
  const shown = balance != null ? balance : summary?.credits ?? null;
  const fmt = shown != null ? new Intl.NumberFormat('en-US').format(shown) : '—';
  const assetFmt = assets != null ? new Intl.NumberFormat('en-US').format(assets) : '—';
  const assetWord = assets === 1 ? 'asset' : 'assets';
  return (
    <div data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link
        href="/app"
        aria-label="Veyrnox studio — explore"
        className={`items-center gap-2.5 shrink-0 ${account ? 'hidden sm:flex' : 'flex'}`}
      >
        {/* Wordmark drops below sm so the three tabs and the balance pill
            fit a 360px viewport without a sideways scroll. Signed in, the
            mark goes too: measured at 360px the account block does not fit
            beside it, and it only repeats where the Explore tab already
            goes. */}
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      <nav aria-label="Studio" className="flex gap-0.5 sm:gap-1 text-[12px] sm:text-sm font-semibold">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            aria-current={active === it.key ? 'page' : undefined}
            className={`px-2 sm:px-4 py-2 rounded-full transition-colors ${
              active === it.key ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <ThemeToggle className="hidden md:inline-flex" />
        {account ? (
          <>
            {/* Both figures stack inside one block: side by side they need
                459px of nav and a phone gives 328. Amber is the credit
                figure and nothing else — the count is body text. */}
            <span className="flex flex-col gap-px rounded-2xl border border-vx-border bg-vx-panel px-1.5 sm:px-2.5 py-0.5">
              <Link
                href="/app/credits"
                aria-label={`Credit balance: ${fmt} credits`}
                className="flex items-center gap-1.5 py-1 leading-none transition-opacity hover:opacity-80"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vx-money" />
                <span className="font-vx-mono text-[11px] font-bold text-vx-money vx-num">{fmt} cr</span>
              </Link>
              <Link
                href="/app/library"
                aria-label={`${assetFmt} ${assetWord} in your library`}
                className="flex items-center gap-1.5 py-1 leading-none transition-opacity hover:opacity-80"
              >
                {/* Keeps the count's first digit under the balance's. */}
                <span aria-hidden="true" className="h-1.5 w-1.5" />
                <span className="font-vx-mono text-[11px] font-bold text-vx-fg-body vx-num">{assetFmt}</span>
                <span aria-hidden="true" className="font-vx-mono text-[11px] font-bold text-vx-fg-muted">{assetWord}</span>
              </Link>
            </span>
            {/* The account menu the marketing nav already ships: who you
                are, links into the app, sign out. Named from the signed-in
                session, with /account's verified email behind it. */}
            <NavAuthButtons account={account} />
          </>
        ) : (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required', { detail: { mode: 'sign_in' } }))}
            className="rounded-full bg-vx-accent text-vx-accent-ink text-[13px] sm:text-sm font-bold px-3 sm:px-4 py-2 hover:bg-vx-accent-hover"
          >
            Sign in
          </button>
        )}
      </div>
    </div>
  );
}
