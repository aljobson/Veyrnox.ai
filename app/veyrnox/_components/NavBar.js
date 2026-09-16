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

// Marketing site nav (Home / Gallery / Pricing).
export function MarketingNav() {
  // Rewrites serve /veyrnox/* at /*, so the browser path has no prefix.
  const path = usePathname().replace(/^\/veyrnox/, '') || '/';
  const items = [
    { href: '/',         label: 'Home' },
    { href: '/presets', label: 'Gallery' },
    { href: '/pricing', label: 'Pricing' },
  ];
  return (
    <div data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link href="/" aria-label="Veyrnox.ai — home" className="flex items-center gap-2.5 shrink-0">
        <Logo wordmark />
      </Link>
      <nav aria-label="Primary" className="hidden sm:flex gap-1.5 text-sm font-semibold">
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
        <MobileMenu items={items} className="sm:hidden" />
      </div>
    </div>
  );
}

// Web app nav (Explore / Create / Library) with a live balance pill.
// If `balance` prop is provided the parent owns it; otherwise the pill
// self-fetches and subscribes to veyrnox:balance-changed.
export function AppNav({ balance, active = 'explore' }) {
  const items = [
    { key: 'explore', href: '/app',         label: 'Explore' },
    { key: 'create',  href: '/app/create',  label: 'Create' },
    { key: 'library', href: '/app/library', label: 'Library' },
  ];
  const [ownBalance, setOwnBalance] = useState(null);
  const loadOwn = useCallback(async () => {
    try {
      const b = await gatewayFetch('/balance');
      setOwnBalance(b.balance);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) setOwnBalance(null);
    }
  }, []);
  useEffect(() => {
    if (balance != null) return;              // parent owns it
    loadOwn();
    const onBal = () => loadOwn();
    window.addEventListener('veyrnox:balance-changed', onBal);
    return () => window.removeEventListener('veyrnox:balance-changed', onBal);
  }, [balance, loadOwn]);
  const shown = balance != null ? balance : ownBalance;
  const fmt = shown != null ? new Intl.NumberFormat('en-US').format(shown) : '—';
  return (
    <div data-print="hide" className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 sm:px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link href="/app" aria-label="Veyrnox studio — explore" className="flex items-center gap-2.5 shrink-0">
        {/* Wordmark drops below sm so the three tabs and the balance pill
            fit a 360px viewport without a sideways scroll. */}
        <Logo className="sm:hidden" />
        <Logo wordmark className="hidden sm:inline-flex" />
      </Link>
      <nav aria-label="Studio" className="flex gap-0.5 sm:gap-1 text-[13px] sm:text-sm font-semibold">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            aria-current={active === it.key ? 'page' : undefined}
            className={`px-2.5 sm:px-4 py-2 rounded-full transition-colors ${
              active === it.key ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2 shrink-0">
        <ThemeToggle className="hidden md:inline-flex" />
        <Link
          href="/app/credits"
          aria-label={`Credit balance: ${fmt} credits`}
          className="flex items-center gap-1.5 rounded-full border border-vx-border bg-vx-panel px-2.5 sm:px-3 py-1.5 transition-colors hover:border-vx-accent"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vx-money" />
          <span className="font-vx-mono text-[11px] sm:text-[12px] font-bold text-vx-money vx-num">{fmt} cr</span>
        </Link>
      </div>
    </div>
  );
}
