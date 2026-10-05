'use client';
import { useEffect, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { CopyButton } from './CopyButton';

// ADR-0071: the signed-in account's own referral link and how many friends joined through it. Shows nothing while the feature is off.
export function ReferralPanel() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    gatewayFetch('/referrals')
      .then((r) => { if (live && r && r.enabled && typeof r.code === 'string') setInfo({ code: r.code, referred: Number.isInteger(r.referred) ? r.referred : 0 }); })
      .catch(() => {}); // no panel is the safe answer
    return () => { live = false; };
  }, []);
  if (!info) return null;
  const link = `${window.location.origin}/?ref=${info.code}`;
  return (
    <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="refer-heading">
      <h2 id="refer-heading" className="font-bold mb-2">Refer a friend</h2>
      <p className="text-sm text-vx-fg-muted mb-4">
        When a friend you refer buys their first Credit Pack, you earn Credits worth 10% of that Pack, added to your balance 14 days later
        if the purchase has not been refunded or disputed. Credits only; they never expire. Nothing is paid out as money.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input readOnly aria-label="Your referral link" value={link} onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
        <CopyButton value={link} label="Copy link" title="Copy your referral link" />
      </div>
      <p className="text-sm text-vx-fg-muted mt-3">
        {info.referred === 1 ? '1 friend has' : `${info.referred} friends have`} joined through your link.
      </p>
    </section>
  );
}
