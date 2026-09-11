'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: 'create',  href: '/muon/m/create',  label: 'Create',  icon: '✧' },
  { key: 'explore', href: '/muon/m/explore', label: 'Explore', icon: '⌘' },
  { key: 'library', href: '/muon/m/library', label: 'Library', icon: '▤' },
  { key: 'credits', href: '/muon/m/credits', label: 'Credits', icon: '$' },
];

export function MobileTabs() {
  const path = usePathname();
  return (
    <div className="flex-shrink-0 border-t border-muon-border bg-muon-base pb-2 pt-2 px-3">
      <div className="flex justify-around">
        {TABS.map((t) => {
          const active = path.startsWith(t.href);
          return (
            <Link
              key={t.key}
              href={t.href}
              className={`flex flex-col items-center gap-1 min-w-14 py-1 ${
                active ? 'text-muon-fg' : 'text-muon-fg-muted'
              }`}
            >
              <span className={`text-lg leading-none ${active ? 'text-muon-accent' : ''}`}>{t.icon}</span>
              <span className="font-muon-mono text-[9px] tracking-[0.1em] font-bold">{t.label.toUpperCase()}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function MobileJumps() {
  const path = usePathname();
  const jumps = [
    { href: '/muon/m/plans',   label: 'PLANS' },
    { href: '/muon/m/create',  label: 'CREATE' },
    { href: '/muon/m/job',     label: 'JOB' },
    { href: '/muon/m/explore', label: 'EXPLORE' },
    { href: '/muon/m/library', label: 'LIBRARY' },
    { href: '/muon/m/credits', label: 'CREDITS' },
  ];
  return (
    <div className="flex gap-1.5 flex-wrap justify-center py-4 px-3">
      {jumps.map((j) => {
        const active = path === j.href;
        return (
          <Link
            key={j.href}
            href={j.href}
            className={`font-muon-mono text-[10px] font-bold tracking-[0.12em] px-3.5 py-2 rounded-full border ${
              active
                ? 'bg-muon-accent text-muon-accent-ink border-transparent'
                : 'border-muon-border text-muon-fg-muted'
            }`}
          >
            {j.label}
          </Link>
        );
      })}
    </div>
  );
}
