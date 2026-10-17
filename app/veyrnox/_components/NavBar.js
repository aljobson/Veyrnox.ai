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
import { getStoredSession, onSessionChange } from '../../lib/authClient';
import { accountLabel } from '../_lib/account';
import { useProjectsEnabled } from './ProjectsFlag';
import { useVideoEnhancePreview } from '../_lib/useVideoEnhancePreview';
import { useEditorEnabled } from './EditorFlag';
import { NAV_CATEGORIES, PRIMARY_NAV_CATEGORIES } from '../_lib/tokens';
import { AnnouncementBar } from './AnnouncementBar';
import { PaywallPrompt } from './PaywallPrompt';

// Studio pages keep the making tools in the tab strip. This complementary
// list makes the rest of the public site reachable from that same header,
// without pretending private account areas are public destinations. An entry
// with a studioHref is the public front of a studio tab the strip already has.
const APP_BROWSE_CATEGORIES = NAV_CATEGORIES.filter((item) => !item.href.startsWith('/app/') && !item.studioHref);

// The public site's nav: every marketing page, the home page included. One
// destination list. The bar exposes creation jobs; More carries the full
// route directory without forcing secondary product names into the header.
export function MarketingNav({ hideAnnouncementOnMobile = false }) {
  // Rewrites serve /veyrnox/* at /*, so the browser path has no prefix.
  const path = usePathname().replace(/^\/veyrnox/, '') || '/';
  return (
    <>
    <div className={hideAnnouncementOnMobile ? 'hidden sm:block' : undefined}><AnnouncementBar /></div>
    <header data-print="hide" className="sticky top-0 z-40 h-16 border-b border-vx-border bg-vx-base/88 backdrop-blur-sm">
      {/* Same 1300px column as the page body, so the logo sits on its edge. */}
      <div className="h-full max-w-[1300px] mx-auto px-4 sm:px-6 flex items-center gap-1 sm:gap-3 xl:gap-6">
      <Link href="/" aria-label="Veyrnox.ai home" className="flex items-center shrink-0">
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      {/* Keep the five primary destinations visible at ordinary desktop
          widths. The adjacent menu carries the complete list without ever
          forcing the logo or account controls out of the bar. */}
      <nav aria-label="Primary" className="hidden xl:flex flex-1 min-w-0 items-center gap-0.5 text-[12px] font-semibold">
        {PRIMARY_NAV_CATEGORIES.map((it) => {
          const section = it.href.includes('#');
          const destination = it.href.split(/[?#]/)[0];
          const active = !section && path.startsWith(destination);
          const featured = it.featured === true;
          const Item = section ? 'a' : Link;
          return (
            <Item
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 transition-colors ${
                active
                  ? 'bg-vx-accent text-vx-accent-ink'
                  : featured
                    ? 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                    : 'text-vx-fg-body hover:bg-vx-panel hover:text-vx-fg'
              }`}
            >
              {featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
              {it.label}
            </Item>
          );
        })}
      </nav>
      <div className="flex flex-1 xl:flex-none items-center justify-end gap-1 sm:gap-2 shrink-0">
        <SiteSearch className="hidden sm:inline-flex" />
        <ThemeToggle className="hidden xl:inline-flex" />
        <NavAuthButtons />
        <MobileMenu
          items={NAV_CATEGORIES}
          buttonLabel="More navigation"
        />
      </div>
      </div>
    </header>
    </>
  );
}

// Web app nav (Explore / Create / Library). Signed in, the right-hand side
// says who you are, what you can spend and how much you have made; signed
// out it is a single sign-in button and no figures at all.
// If `balance` prop is provided the parent owns it; otherwise the pill
// self-fetches and subscribes to veyrnox:balance-changed.
export function AppNav({ balance, active = 'explore', readAccount = true }) {
  const projectsEnabled = useProjectsEnabled();
  const enhanceEnabled = useVideoEnhancePreview();
  const editorEnabled = useEditorEnabled();
  const items = [
    { key: 'explore', href: '/app',         label: 'Explore' },
    { key: 'oddlings', href: '/app/oddlings', label: 'Oddlings', featured: true },
    { key: 'create',  href: '/app/create',  label: 'Create' },
    // Video agent (ADR-0074): bought from a plan on its own page, so it has its own tab and is not in the Create picker.
    { key: 'agent', href: '/app/video-agent', label: 'Video agent' },
    { key: 'chat', href: '/app/chat', label: 'LLM Chat' },
    { key: 'film', href: '/app/film-studio', label: 'Film Studio' },
    { key: 'library', href: '/app/library', label: 'Library' },
    ...(editorEnabled ? [{ key: 'editor', href: '/app/editor', label: 'Video editor' }] : []),
    ...(projectsEnabled ? [{ key: 'projects', href: '/app/projects', label: 'Projects' }] : []),
    ...(enhanceEnabled ? [{ key: 'enhance', href: '/app/enhance', label: 'Enhance' }] : []),
  ];
  const primaryKeys = new Set(['explore', 'create', 'library']);
  const primaryItems = items.filter((item) => primaryKeys.has(item.key));
  const moreItems = items.filter((item) => !primaryKeys.has(item.key));
  const menuItems = [
    ...items,
    ...APP_BROWSE_CATEGORIES.filter((browse) => !items.some((item) => item.href === browse.href)),
  ];
  // Stored identity is display metadata, not authorization. It needs no
  // network to draw the nav while the HttpOnly session restores. Google puts
  // one in user_metadata, and public.users has no such column. The endpoint
  // only supplies the email, for the sessions that carry none.
  const [session, setSession] = useState(null);
  useEffect(() => {
    setSession(getStoredSession());
    return onSessionChange(setSession);
  }, []);
  // One server read for all three figures: who you are, the balance and
  // the true asset count for the account (not this browser's history).
  // A generation both spends credits and stores an asset, so the existing
  // veyrnox:balance-changed is already the moment all of it moved.
  const [summary, setSummary] = useState(null);
  const loadSummary = useCallback(async () => {
    if (!readAccount || !session) { setSummary(null); return; }
    try {
      setSummary(await gatewayFetch('/account'));
    } catch (e) {
      // Signed out: drop the figures with the session. Any other failure
      // keeps the last good read — a stale number beats a wrong one, and
      // an unanswered read renders "—", never a spinner.
      if (e instanceof GatewayError && e.status === 401) setSummary(null);
    }
  }, [readAccount, session]);
  useEffect(() => {
    loadSummary();
    const onBal = () => loadSummary();
    window.addEventListener('veyrnox:balance-changed', onBal);
    return () => window.removeEventListener('veyrnox:balance-changed', onBal);
  }, [loadSummary]);
  const account = accountLabel(session, summary?.email || '');

  const assets = summary?.assets ?? null;
  const shown = balance != null ? balance : summary?.credits ?? null;
  const fmt = shown != null ? new Intl.NumberFormat('en-US').format(shown) : '—';
  const assetFmt = assets != null ? new Intl.NumberFormat('en-US').format(assets) : '—';
  const assetWord = assets === 1 ? 'asset' : 'assets';
  return (
    <header data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/88 backdrop-blur-sm">
      {summary && <PaywallPrompt credits={summary.credits} createdAt={summary.created_at} />}
      <Link
        href="/app"
        aria-label="Veyrnox studio — explore"
        className={`items-center gap-2.5 shrink-0 ${account ? 'hidden sm:flex' : 'flex'}`}
      >
        {/* On signed-in phones the Studio menu carries every destination, so
            the mark yields to the balance and account controls. */}
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      <MobileMenu
        items={menuItems}
        activeHref={items.find((item) => item.key === active)?.href}
        buttonLabel="Studio menu"
        navLabel="Studio"
        className="lg:hidden"
      />
      <nav aria-label="Studio" className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 text-[12px] font-semibold sm:gap-1 sm:text-sm lg:flex">
        {primaryItems.map((it) => {
          const current = active === it.key;
          return (
            <Link
              key={it.key}
              href={it.href}
              aria-current={current ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-2 transition-colors sm:px-4 ${
                current
                  ? it.featured ? 'bg-vx-accent text-vx-accent-ink' : 'bg-vx-panel text-vx-fg'
                  : it.featured
                    ? 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                    : 'text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {it.featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
              {it.label}
            </Link>
          );
        })}
        <details className="group relative 2xl:hidden">
          <summary className={`cursor-pointer list-none rounded-full px-2 py-2 hover:bg-vx-panel hover:text-vx-fg sm:px-3 ${
            moreItems.some((item) => item.key === active) ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted'
          }`}>
            More <span aria-hidden="true">▾</span>
          </summary>
          <div className="absolute left-1/2 top-[calc(100%+0.5rem)] z-50 min-w-48 -translate-x-1/2 rounded-2xl border border-vx-border bg-vx-panel p-2 shadow-2xl">
            {moreItems.map((it) => (
              <Link
                key={it.key}
                href={it.href}
                aria-current={active === it.key ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${
                  active === it.key ? 'bg-vx-base text-vx-fg' : 'text-vx-fg-muted hover:bg-vx-base hover:text-vx-fg'
                }`}
              >
                {it.featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vx-accent" />}
                {it.label}
              </Link>
            ))}
          </div>
        </details>
        <div className="hidden items-center gap-1 2xl:flex">
          {moreItems.map((it) => {
            const current = active === it.key;
            return (
              <Link
                key={it.key}
                href={it.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 transition-colors ${
                  current
                    ? it.featured ? 'bg-vx-accent text-vx-accent-ink' : 'bg-vx-panel text-vx-fg'
                    : it.featured
                      ? 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                      : 'text-vx-fg-muted hover:text-vx-fg'
                }`}
              >
                {it.featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
                {it.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <MobileMenu
          items={APP_BROWSE_CATEGORIES}
          buttonLabel="Browse more Veyrnox pages"
          buttonText="Browse"
          navLabel="More Veyrnox pages"
          className="hidden lg:block"
        />
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
                className="flex min-h-6 items-center gap-1.5 py-1 leading-none transition-opacity hover:opacity-80"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vx-money" />
                <span className="font-vx-mono text-[11px] font-bold text-vx-money vx-num">{fmt} cr</span>
              </Link>
              <Link
                href="/app/library"
                aria-label={`${assetFmt} ${assetWord} in your library`}
                className="flex min-h-6 items-center gap-1.5 py-1 leading-none transition-opacity hover:opacity-80"
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
    </header>
  );
}
