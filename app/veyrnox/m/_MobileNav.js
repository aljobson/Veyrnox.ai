'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { key: 'create',  href: '/veyrnox/m/create',  label: 'Create',  icon: '✧' },
  { key: 'explore', href: '/veyrnox/m/explore', label: 'Explore', icon: '⌘' },
  { key: 'library', href: '/veyrnox/m/library', label: 'Library', icon: '▤' },
  { key: 'credits', href: '/veyrnox/m/credits', label: 'Credits', icon: '$' },
];

export function MobileTabs() {
  const path = usePathname();
  return (
    <div className="flex-shrink-0 border-t border-vx-border bg-vx-base pb-2 pt-2 px-3">
      <div className="flex justify-around">
        {TABS.map((t) => {
          const active = path.startsWith(t.href);
          return (
            <Link
              key={t.key}
              href={t.href}
              className={`flex flex-col items-center gap-1 min-w-14 py-1 ${
                active ? 'text-vx-fg' : 'text-vx-fg-muted'
              }`}
            >
              <span className={`text-lg leading-none ${active ? 'text-vx-accent' : ''}`}>{t.icon}</span>
              <span className="font-vx-mono text-[9px] tracking-[0.1em] font-bold">{t.label.toUpperCase()}</span>
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
    { href: '/veyrnox/m/create',  label: 'CREATE' },
    { href: '/veyrnox/m/job',     label: 'JOB' },
    { href: '/veyrnox/m/explore', label: 'EXPLORE' },
    { href: '/veyrnox/m/library', label: 'LIBRARY' },
    { href: '/veyrnox/m/credits', label: 'CREDITS' },
  ];
  return (
    <div className="flex gap-1.5 flex-wrap justify-center py-4 px-3">
      {jumps.map((j) => {
        const active = path === j.href;
        return (
          <Link
            key={j.href}
            href={j.href}
            className={`font-vx-mono text-[10px] font-bold tracking-[0.12em] px-3.5 py-2 rounded-full border ${
              active
                ? 'bg-vx-accent text-vx-accent-ink border-transparent'
                : 'border-vx-border text-vx-fg-muted'
            }`}
          >
            {j.label}
          </Link>
        );
      })}
    </div>
  );
}
