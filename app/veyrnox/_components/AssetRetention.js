'use client';
import { useEffect, useState } from 'react';
import { assetRetention } from '../_lib/assetRetention';

export function AssetRetention({ row }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const notice = assetRetention(row, now);
  if (!notice) return null;
  return <p className={`px-4 pb-3 text-xs ${notice.urgent ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>{notice.text}</p>;
}
