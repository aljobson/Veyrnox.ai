'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import { NavAuthButtons } from './NavAuthButtons';
import { MobileMenu } from './MobileMenu';
import { SiteSearch } from './SiteSearch';
import { ThemeToggle } from './ThemeToggle';
import { gatewayFetch, GatewayError } from '../_lib/gateway';
import { getSession, onSessionChange } from '../../lib/authClient';
import { accountLabel } from '../_lib/account';
import { useProjectsEnabled } from './ProjectsFlag';
import { useVideoEnhancePreview } from '../_lib/useVideoEnhancePreview';
import { useEditorEnabled } from './EditorFlag';
import { NAV_CATEGORIES } from '../_lib/tokens';
import { AnnouncementBar } from './AnnouncementBar';

const MOBILE_NAV_CATEGORIES = [
  ...NAV_CATEGORIES.filter((item) => item.href === '/app/oddlings'),
  ...NAV_CATEGORIES.filter((item) => item.href === '/social-cinema'),
  ...NAV_CATEGORIES.filter((item) => item.href !== '/app/oddlings' && item.href !== '/social-cinema' && item.href !== '/#faq'),
  ...NAV_CATEGORIES.filter((item) => item.href === '/#faq'),
];

const COMPACT_NAV_CATEGORIES = NAV_CATEGORIES.filter((item) => [
  '/app/oddlings',
  '/#explore',
  '/#models',
  '/presets',
  '/tools',
  '/guides',
  '/pricing',
].includes(item.href));

// Studio pages keep the making tools in the tab strip. This complementary
// list makes the rest of the public site reachable from that same header,
// without pretending private account areas are public destinations.
const APP_BROWSE_CATEGORIES = NAV_CATEGORIES.filter((item) => ![
  '/app/oddlings',
  '/app/chat',
].includes(item.href));

// The public site's nav: every marketing page, the home page included. One
// destination list, with a compact menu order that leads with Oddlings and
// leaves FAQ at the bottom. Desktop keeps its established order.
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
        {COMPACT_NAV_CATEGORIES.map((it) => {
          const section = it.href.includes('#');
          const active = !section && path.startsWith(it.href);
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
      {/* Oddlings is a public destination, not an account feature. Keep it
          directly visible whenever the full desktop nav is collapsed. */}
      <Link
        href="/app/oddlings"
        aria-current={path.startsWith('/app/oddlings') ? 'page' : undefined}
        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] font-extrabold xl:hidden ${
          path.startsWith('/app/oddlings')
            ? 'border-vx-accent bg-vx-accent text-vx-accent-ink'
            : 'border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
        }`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
        Oddlings
      </Link>
      <div className="flex flex-1 xl:flex-none items-center justify-end gap-1 sm:gap-2 shrink-0">
        <SiteSearch className="hidden sm:inline-flex" />
        <ThemeToggle className="hidden xl:inline-flex" />
        <NavAuthButtons />
        <MobileMenu
          items={MOBILE_NAV_CATEGORIES}
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
  const tabs = useRef(null);
  // Keeps the current desktop tab on screen when the strip overflows. The
  // strip is moved by hand: scrollIntoView() also moves where the next Tab
  // starts from, so on every studio page the first Tab went past "Skip to
  // content" and the tabs before this one.
  useEffect(() => {
    const strip = tabs.current;
    const current = strip?.querySelector('[aria-current="page"]');
    if (!current) return;
    const edge = strip.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.left < edge.left) strip.scrollLeft -= edge.left - tab.left;
    else if (tab.right > edge.right) strip.scrollLeft += tab.right - edge.right;
  }, [active, projectsEnabled, enhanceEnabled, editorEnabled]);
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
  const menuItems = [
    ...items,
    ...APP_BROWSE_CATEGORIES.filter((browse) => !items.some((item) => item.href === browse.href)),
  ];
  // Who is signed in. The session in localStorage is the gate — it needs no
  // network, so public app pages never make an authenticated request merely
  // to draw their nav. It also already holds the display name: Google puts
  // one in user_metadata, and public.users has no such column. The endpoint
  // only supplies the email, for the sessions that carry none.
  const [session, setSession] = useState(null);
  useEffect(() => {
    setSession(getSession());
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
      <nav ref={tabs} aria-label="Studio" className="hidden lg:flex min-w-0 overflow-x-auto gap-0.5 sm:gap-1 text-[12px] sm:text-sm font-semibold">
        {items.map((it) => {
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
