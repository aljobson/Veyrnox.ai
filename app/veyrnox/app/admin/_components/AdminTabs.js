'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleAdminTabs } from '../../../../../lib/adminTabs';

export function AdminTabs({ isAdmin = false, permissions = [] }) {
  const pathname = usePathname();
  const tabs = visibleAdminTabs({ isAdmin, permissions });
  if (!tabs.length) return null;
  return <nav aria-label="Admin sections" className="my-6 flex flex-wrap gap-2">
    {tabs.map(tab => {
      const href = `/app/admin/${tab.id}`;
      const active = pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={tab.id} href={href} aria-current={active ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent ${active ? 'border-vx-accent text-vx-accent' : 'border-vx-border text-vx-fg'}`}>
        {tab.label}
      </Link>;
    })}
  </nav>;
}
