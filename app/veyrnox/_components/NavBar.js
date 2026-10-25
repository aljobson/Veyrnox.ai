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
import { usePublishEnabled } from './PublishFlag';
import { useVideoEnhancePreview } from '../_lib/useVideoEnhancePreview';
import { useEditorEnabled } from './EditorFlag';
import { NAV_CATEGORIES, PRIMARY_NAV_CATEGORIES } from '../_lib/tokens';
import { AnnouncementBar } from './AnnouncementBar';
import { ModelsMenu } from './ModelsMenu';
import { PaywallPrompt } from './PaywallPrompt';
import { LanguageMenu } from './LanguageMenu';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../lib/i18n/translate.mjs';

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
  const { t, href } = useI18n();
  return (
    <>
    <div className={hideAnnouncementOnMobile ? 'hidden sm:block' : undefined}><AnnouncementBar /></div>
    <header data-print="hide" className="sticky top-0 z-40 h-16 border-b border-vx-border bg-vx-base/88 backdrop-blur-sm">
      {/* Same 1300px column as the page body, so the logo sits on its edge. */}
      <div className="h-full max-w-[1300px] mx-auto px-4 sm:px-6 flex items-center gap-1 sm:gap-3 xl:gap-6">
      <Link href={href('/')} aria-label={t('ui.home')} className="flex items-center shrink-0">
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      {/* Keep the five primary destinations visible at ordinary desktop
          widths. The adjacent menu carries the complete list without ever
          forcing the logo or account controls out of the bar. */}
      <nav aria-label={t('ui.primary')} className="hidden xl:flex flex-1 min-w-0 items-center gap-0.5 text-[12px] font-semibold">
        {PRIMARY_NAV_CATEGORIES.map((it) => {
          const section = it.href.includes('#');
          const destination = it.href.split(/[?#]/)[0];
          const active = !section && path.startsWith(destination);
          const featured = it.featured === true;
          const Item = section ? 'a' : Link;
          if (it.href === '/models') {
            return <ModelsMenu key={it.href} active={active} />;
          }
          return (
            <Item
              key={it.href}
              href={href(it.href)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-2 transition-colors ${
                active
                  ? 'bg-vx-accent text-vx-accent-ink'
                  : featured
                    ? 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20'
                    : 'vx-side-row text-vx-fg-body'
              }`}
            >
              {featured && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
              {t.label(it.label)}
            </Item>
          );
        })}
      </nav>
      <div className="flex flex-1 xl:flex-none items-center justify-end gap-1 sm:gap-2 shrink-0">
        <SiteSearch className="hidden sm:inline-flex" />
        <LanguageMenu />
        <ThemeToggle className="hidden xl:inline-flex" />
        <NavAuthButtons />
        <MobileMenu
          items={NAV_CATEGORIES}
          grouped
          buttonLabel={t('ui.moreNav')}
        />
      </div>
      </div>
    </header>
    </>
  );
}

// Sidebar glyphs live here, not in Icon.js: a new import edge from this file
// reorders the Vey knowledge scan, which follows only 80 modules per route.
const SIDE_ICONS = {
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  chat: <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />,
  agent: <path d="m12 3 1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4ZM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8Z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="m16 10 5-3v10l-5-3" />
    </>
  ),
  film: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 4v16M16 4v16M4 9h4m8 0h4M4 15h4m8 0h4" />
    </>
  ),
  character: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  wand: <path d="m5 19 9-9m0 0 2-5 1 4 4 1-5 2m-2-2 2 2M5 5v3M3.5 6.5h3" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="m8 8 12 9M8 16 20 7" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  library: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m10 9 5 3-5 3Z" />
    </>
  ),
  coins: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8m-2.5-6h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
    </>
  ),
  template: (
    <>
      <rect x="4" y="4" width="7" height="16" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </>
  ),
  cube: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9ZM12 12l8-4.5M12 12 4 7.5M12 12v9" />,
  book: <path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Zm0 13a3 3 0 0 1 3-3h10" />,
  send: <path d="m21 3-9.5 9.5M21 3l-6.5 18-3-8.5L3 9.5Z" />,
  plug: <path d="M9 3v5m6-5v5M7 8h10v3a5 5 0 0 1-10 0Zm5 8v5" />,
};

function Icon({ name, size = 16, className = '' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      {SIDE_ICONS[name]}
    </svg>
  );
}

const COLLAPSED_KEY = 'veyrnox_sidebar_collapsed';
const SECTIONS_KEY = 'veyrnox_sidebar_sections';

// Per-viewer convenience only: every read and write tolerates blocked storage.
function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeStore(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

function SectionHeading({ id, label, open, onToggle, rail }) {
  if (rail) return <div role="separator" className="mx-3 my-2 border-t border-vx-border" />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`vx-side-${id}`}
      className="flex min-h-10 w-full items-center gap-2 px-2.5 pt-3 text-start text-[11px] font-semibold text-vx-fg-muted transition-colors duration-150 hover:text-vx-fg"
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} className="rtl:-scale-x-100" />
      {label}
    </button>
  );
}

function featuredClasses(current) {
  return current
    ? 'bg-vx-accent text-vx-accent-ink'
    : 'border border-vx-accent/50 bg-vx-accent/10 text-vx-accent hover:bg-vx-accent/20';
}

// OpenArt-style left rail: home, then Agents / Tools / Assets / Inspire. Fixed
// beside the page on desktop; the Studio menu keeps carrying phones.
// veyrnox.css pads .vx-root by the rail's width while this is mounted.
function AppSidebar({ sections, homeLabel, logoLabel, accountLabel, accountHref, activeKey, activeHref, 'aria-label': label, collapseLabel, expandLabel }) {
  const [rail, setRail] = useState(false);
  const [closed, setClosed] = useState({});
  useEffect(() => {
    setRail(readStore(COLLAPSED_KEY, false) === true);
    setClosed(readStore(SECTIONS_KEY, {}));
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-vx-rail', rail);
  }, [rail]);
  useEffect(() => () => document.documentElement.removeAttribute('data-vx-rail'), []);

  const toggleRail = () => {
    setRail((prev) => {
      writeStore(COLLAPSED_KEY, !prev);
      return !prev;
    });
  };
  const toggleSection = (id) => {
    setClosed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeStore(SECTIONS_KEY, next);
      return next;
    });
  };
  const isCurrent = (item) => (item.key ? item.key === activeKey : item.href === activeHref);

  return (
    <aside
      data-print="hide"
      aria-label={label}
      className="vx-sidebar fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-vx-border bg-vx-base lg:flex"
    >
      <div className={`flex h-16 shrink-0 items-center ${rail ? 'justify-center' : 'justify-between px-4'}`}>
        {!rail && (
          <Link href="/app" aria-label={logoLabel} className="flex items-center">
            <Logo wordmark />
          </Link>
        )}
        <button
          type="button"
          onClick={toggleRail}
          aria-label={rail ? expandLabel : collapseLabel}
          aria-pressed={rail}
          className="vx-side-row inline-flex h-10 w-10 items-center justify-center rounded-xl text-vx-fg-muted"
        >
          <Icon name="panel" size={18} className="rtl:-scale-x-100" />
        </button>
      </div>

      <nav aria-label={label} className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-6">
        {accountLabel && (
          <Link
            href={accountHref}
            title={accountLabel}
            className={`mb-1 flex items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel py-2.5 text-sm font-semibold text-vx-fg hover:border-vx-accent ${rail ? 'justify-center px-0' : 'px-3'}`}
          >
            <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-vx-accent text-xs font-bold text-vx-accent-ink">
              {accountLabel.trim().charAt(0).toUpperCase()}
            </span>
            {!rail && <span className="min-w-0 flex-1 truncate">{accountLabel}</span>}
            {!rail && <Icon name="chevronRight" size={14} className="text-vx-fg-muted rtl:-scale-x-100" />}
          </Link>
        )}

        <Link
          href="/app"
          title={homeLabel}
          aria-current={activeKey === 'explore' ? 'page' : undefined}
          className={`vx-side-row flex min-h-10 items-center gap-2.5 rounded-xl text-[13px] font-medium text-vx-fg-body ${rail ? 'justify-center px-0' : 'px-2.5'}`}
        >
          <Icon name="home" size={16} />
          {!rail && homeLabel}
        </Link>

        {sections.map((section) => {
          const open = !closed[section.id];
          return (
            <div key={section.id}>
              <SectionHeading id={section.id} label={section.label} open={open} rail={rail} onToggle={() => toggleSection(section.id)} />
              {(open || rail) && (
                <ul
                  id={`vx-side-${section.id}`}
                  className="flex flex-col gap-1"
                >
                  {section.items.map((item) => {
                    const current = isCurrent(item);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={item.label}
                          aria-current={current ? 'page' : undefined}
                          className={`flex min-h-10 items-center rounded-xl text-[13px] font-medium ${
                            rail ? 'justify-center px-0' : 'gap-2.5 px-2.5'
                          } ${
                            item.featured && !rail
                              ? `transition-colors duration-150 ${featuredClasses(current)}`
                              : 'vx-side-row text-vx-fg-body'
                          }`}
                        >
                          <Icon name={item.icon} size={16} />
                          {!rail && <span className="min-w-0 truncate">{item.label}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// Web app nav (Explore / Create / Library). Signed in, the right-hand side
// says who you are, what you can spend and how much you have made; signed
// out it is a single sign-in button and no figures at all.
// If `balance` prop is provided the parent owns it; otherwise the pill
// self-fetches and subscribes to veyrnox:balance-changed.
export function AppNav({ balance, active = 'explore', readAccount = true }) {
  const { t, locale } = useI18n();
  const projectsEnabled = useProjectsEnabled();
  const publishEnabled = usePublishEnabled();
  const enhanceEnabled = useVideoEnhancePreview();
  const editorEnabled = useEditorEnabled();
  const items = [
    { key: 'explore', href: '/app',         label: t("label.Explore") },
    { key: 'oddlings', href: '/app/oddlings', label: t("label.Oddlings") },
    { key: 'create',  href: '/app/create',  label: t("label.Create") },
    { key: 'features', href: '/app/features', label: t('label.Tools') },
    // Video agent (ADR-0074): bought from a plan on its own page, so it has its own tab and is not in the Create picker.
    { key: 'agent', href: '/app/video-agent', label: t("app.nav.videoAgent") },
    { key: 'skills', href: '/app/skills', label: t('label.Studio skills') },
    { key: 'chat', href: '/app/chat', label: t("label.LLM Chat") },
    { key: 'film', href: '/app/film-studio', label: t("label.Film Studio") },
    { key: 'library', href: '/app/library', label: t("label.Library") },
    ...(editorEnabled ? [{ key: 'editor', href: '/app/editor', label: t("label.Video editor") }] : []),
    ...(projectsEnabled ? [{ key: 'projects', href: '/app/projects', label: t("label.Projects") }] : []),
    ...(publishEnabled ? [{ key: 'publish', href: '/app/publish', label: t("app.nav.publish") }] : []),
    ...(enhanceEnabled ? [{ key: 'enhance', href: '/app/enhance', label: t("label.Enhance") }] : []),
  ];
  // The public taxonomy intentionally mentions some destinations in more
  // than one group. The compact app menu is one flat list, so keep the first
  // useful occurrence of each route instead of rendering duplicate links.
  const menuItems = [...new Map([
    ...items,
    ...APP_BROWSE_CATEGORIES,
  ].map((item) => [item.href, item])).values()];
  const sidebarSections = [
    { id: 'agents', label: t('app.nav.side.agents'), items: [
      { key: 'skills', href: '/app/skills', label: t('label.Studio skills'), icon: 'wand' },
      { key: 'chat', href: '/app/chat', label: t('label.LLM Chat'), icon: 'chat' },
      { key: 'agent', href: '/app/video-agent', label: t('app.nav.videoAgent'), icon: 'agent' },
    ] },
    { id: 'tools', label: t('app.nav.side.tools'), items: [
      { key: 'create', href: '/app/create', label: t('label.Create'), icon: 'image' },
      { key: 'features', href: '/app/features', label: t('label.Tools'), icon: 'wand' },
      { key: 'film', href: '/app/film-studio', label: t('label.Film Studio'), icon: 'film' },
      { key: 'oddlings', href: '/app/oddlings', label: t('label.Oddlings'), icon: 'character' },
      ...(enhanceEnabled ? [{ key: 'enhance', href: '/app/enhance', label: t('label.Enhance'), icon: 'wand' }] : []),
      ...(editorEnabled ? [{ key: 'editor', href: '/app/editor', label: t('label.Video editor'), icon: 'scissors' }] : []),
      { href: '/mcp', label: t('label.MCP'), icon: 'plug' },
    ] },
    { id: 'assets', label: t('app.nav.side.assets'), items: [
      { key: 'library', href: '/app/library', label: t('label.Library'), icon: 'library' },
      ...(projectsEnabled ? [{ key: 'projects', href: '/app/projects', label: t('label.Projects'), icon: 'folder' }] : []),
      ...(publishEnabled ? [{ key: 'publish', href: '/app/publish', label: t('app.nav.publish'), icon: 'send' }] : []),
      { key: 'credits', href: '/app/credits', label: t('label.Credits'), icon: 'coins' },
    ] },
    { id: 'inspire', label: t('app.nav.side.inspire'), items: [
      { key: 'cinema', href: '/social-cinema', label: t.label('Social Cinema'), icon: 'film' },
      { href: '/presets', label: t('label.Templates'), icon: 'template' },
      { href: '/models', label: t('label.Models'), icon: 'cube' },
      { href: '/guides', label: t('label.Guides'), icon: 'book' },
    ] },
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
  const fmt = shown != null ? new Intl.NumberFormat(localeTag(locale, 'en-US')).format(shown) : '—';
  const assetFmt = assets != null ? new Intl.NumberFormat(localeTag(locale, 'en-US')).format(assets) : '—';
  const assetWord = t(pluralKey(t, locale, 'app.nav.asset', assets ?? 0));
  return (
    <>
    <AppSidebar
      sections={sidebarSections}
      homeLabel={t('label.Home')}
      logoLabel={t('ui.home')}
      accountLabel={account?.name}
      accountHref="/app/account"
      activeKey={active}
      aria-label={t("app.nav.studio")}
      collapseLabel={t('app.nav.side.collapse')}
      expandLabel={t('app.nav.side.expand')}
    />
    <header data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/88 backdrop-blur-sm">
      {summary && <PaywallPrompt credits={summary.credits} createdAt={summary.created_at} />}
      <Link
        href="/app"
        aria-label={t("app.nav.explore")}
        className={`items-center gap-2.5 shrink-0 lg:hidden ${account ? 'hidden sm:flex' : 'flex'}`}
      >
        {/* On signed-in phones the Studio menu carries every destination, so
            the mark yields to the balance and account controls. */}
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      <MobileMenu
        items={menuItems}
        languageMenu
        activeHref={items.find((item) => item.key === active)?.href}
        buttonLabel={t("app.nav.menu")}
        navLabel={t("app.nav.studio")}
        className="lg:hidden"
      />
      <span aria-hidden="true" className="flex-1" />
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <LanguageMenu />
        <ThemeToggle className="hidden md:inline-flex" />
        {account ? (
          <>
            {/* Both figures stack inside one block: side by side they need
                459px of nav and a phone gives 328. Amber is the credit
                figure and nothing else — the count is body text. */}
            <span className="flex flex-col gap-px rounded-2xl border border-vx-border bg-vx-panel px-1.5 sm:px-2.5 py-0.5">
              <Link
                href="/app/credits"
                data-testid="app-credit-balance"
                aria-label={t('app.nav.balance', { count: fmt })}
                className="flex min-h-6 items-center gap-1.5 py-1 leading-none transition-opacity hover:opacity-80"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vx-money" />
                <span className="font-vx-mono text-[11px] font-bold text-vx-money vx-num">{fmt} cr</span>
              </Link>
              <Link
                href="/app/library"
                aria-label={t('app.nav.libraryCount', { count: assetFmt, unit: assetWord })}
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
            {t("oauth.signIn")}</button>
        )}
      </div>
    </header>
    </>
  );
}
