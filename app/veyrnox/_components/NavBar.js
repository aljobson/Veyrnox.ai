'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from './Logo';

// Marketing site nav (Home / Gallery / Pricing).
export function MarketingNav() {
  const path = usePathname();
  const items = [
    { href: '/veyrnox',         label: 'Home' },
    { href: '/veyrnox/presets', label: 'Gallery' },
    { href: '/veyrnox/pricing', label: 'Pricing' },
  ];
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between px-8 h-16 border-b border-muon-border bg-muon-base/[0.88] backdrop-blur">
      <Link href="/veyrnox" className="flex items-center gap-2.5">
        <Logo />
        <span className="font-extrabold text-[15px] tracking-[0.18em]">VEYRNOX</span>
      </Link>
      <div className="flex gap-1.5 text-sm font-semibold">
        {items.map((it) => {
          const active = it.href === '/veyrnox' ? path === '/veyrnox' : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`px-4 py-2 rounded-full transition-colors ${
                active ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted hover:text-muon-fg'
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button className="text-muon-fg-muted text-sm font-semibold px-3 py-2 hover:text-muon-fg">
          Sign in
        </button>
        <Link
          href="/veyrnox/app"
          className="rounded-full bg-muon-accent text-muon-accent-ink text-sm font-bold px-5 py-2.5 hover:bg-muon-accent-hover"
        >
          Start creating
        </Link>
      </div>
    </div>
  );
}

// Web app nav (Explore / Create / Library) with balance pill.
export function AppNav({ balance = 1000, active = 'explore' }) {
  const items = [
    { key: 'explore', href: '/veyrnox/app',         label: 'Explore' },
    { key: 'create',  href: '/veyrnox/app/create',  label: 'Create' },
    { key: 'library', href: '/veyrnox/app/library', label: 'Library' },
  ];
  const fmt = new Intl.NumberFormat('en-US').format(balance);
  return (
    <div className="sticky top-0 z-40 flex items-center justify-between px-8 h-16 border-b border-muon-border bg-muon-base/[0.88] backdrop-blur">
      <Link href="/veyrnox/app" className="flex items-center gap-2.5">
        <Logo />
        <span className="font-extrabold text-[15px] tracking-[0.18em]">VEYRNOX</span>
      </Link>
      <div className="flex gap-1 text-sm font-semibold">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`px-4 py-2 rounded-full transition-colors ${
              active === it.key ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted hover:text-muon-fg'
            }`}
          >
            {it.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Link href="/veyrnox/app/credits" className="flex items-center gap-2 rounded-full border border-muon-border bg-muon-panel px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-muon-money" />
          <span className="font-muon-mono text-[12px] font-bold text-muon-money muon-num">{fmt} cr</span>
        </Link>
      </div>
    </div>
  );
}
