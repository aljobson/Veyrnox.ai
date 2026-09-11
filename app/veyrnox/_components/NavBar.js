'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Logo } from './Logo';
import { gatewayFetch, GatewayError } from '../_lib/gateway';

// Marketing site nav (Home / Gallery / Pricing).
export function MarketingNav() {
  const path = usePathname();
  const items = [
    { href: '/veyrnox',         label: 'Home' },
    { href: '/veyrnox/presets', label: 'Gallery' },
    { href: '/veyrnox/pricing', label: 'Pricing' },
  ];
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link href="/veyrnox" className="flex items-center gap-2.5">
        <Logo wordmark />
      </Link>
      <div className="flex gap-1.5 text-sm font-semibold">
        {items.map((it) => {
          const active = it.href === '/veyrnox' ? path === '/veyrnox' : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`px-4 py-2 rounded-full transition-colors ${
                active ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button className="text-vx-fg-muted text-sm font-semibold px-3 py-2 hover:text-vx-fg">
          Sign in
        </button>
        <Link
          href="/veyrnox/app"
          className="rounded-full bg-vx-accent text-vx-accent-ink text-sm font-bold px-5 py-2.5 hover:bg-vx-accent-hover"
        >
          Start creating
        </Link>
      </div>
    </div>
  );
}

// Web app nav (Explore / Create / Library) with a live balance pill.
// If `balance` prop is provided the parent owns it; otherwise the pill
// self-fetches and subscribes to veyrnox:balance-changed.
export function AppNav({ balance, active = 'explore' }) {
  const items = [
    { key: 'explore', href: '/veyrnox/app',         label: 'Explore' },
    { key: 'create',  href: '/veyrnox/app/create',  label: 'Create' },
    { key: 'library', href: '/veyrnox/app/library', label: 'Library' },
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
    <div className="sticky top-0 z-40 flex items-center justify-between px-8 h-16 border-b border-vx-border bg-vx-base/[0.88] backdrop-blur">
      <Link href="/veyrnox/app" className="flex items-center gap-2.5">
        <Logo wordmark />
      </Link>
      <div className="flex gap-1 text-sm font-semibold">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`px-4 py-2 rounded-full transition-colors ${
              active === it.key ? 'bg-vx-panel text-vx-fg' : 'text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {it.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Link href="/veyrnox/app/credits" className="flex items-center gap-2 rounded-full border border-vx-border bg-vx-panel px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-vx-money" />
          <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num">{fmt} cr</span>
        </Link>
      </div>
    </div>
  );
}
