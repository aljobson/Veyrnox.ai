'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { gatewayFetch } from '../../../_lib/gateway';
import { ADMIN_TABS } from '../../../../../lib/adminTabs';
export function AdminExpansionLinks() {
  const [permissions,setPermissions] = useState([]);
  useEffect(() => {
    let active=true;
    gatewayFetch('/admin/permissions').then(data => { if(active) setPermissions(data.permissions || []); }).catch(() => {});
    return () => { active=false; };
  },[]);
  const tabs = ADMIN_TABS.filter(t => t.id !== 'users' && t.built && permissions.includes(t.permission));
  return tabs.length > 0 && <nav aria-label="Additional admin sections" className="mt-4 flex flex-wrap gap-3">
    {tabs.map(tab => <Link key={tab.id} href={'/app/admin/'+tab.id} className="inline-flex min-h-11 items-center text-sm text-vx-accent underline focus-visible:outline-2 focus-visible:outline-vx-accent">{tab.label}</Link>)}
  </nav>;
}
