'use client';
import { useState } from 'react';
import { MobileTabs } from '../_MobileNav';
import { Chip } from '../../_components/Chip';

const TOPUPS = [
  { cr: 300,  price: '$9'  },
  { cr: 750,  price: '$19' },
  { cr: 2000, price: '$49' },
];

export default function MobileCredits() {
  const [sheet, setSheet] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex-1 overflow-y-auto p-[14px_18px_16px]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">Credits</span>
          <Chip tone="money">PLUS · $39/MO</Chip>
        </div>

        <div className="rounded-2xl border border-muon-border bg-muon-panel p-5">
          <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">CURRENT BALANCE</div>
          <div className="font-muon-mono text-[52px] font-bold text-muon-money leading-none mt-1 muon-num">
            823<span className="text-lg text-muon-fg-muted ml-1.5">cr</span>
          </div>
          <div className="text-[12px] text-muon-fg-body mt-3">
            Renews <b>3 Oct</b> · 1,000 cr on the Plus plan.
          </div>
          <button
            onClick={() => setSheet(true)}
            className="mt-4 w-full flex justify-center items-center bg-muon-money text-muon-money-ink rounded-full py-3 text-[14px] font-extrabold"
          >
            Top up
          </button>
        </div>

        <div className="mt-5 font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">RECENT</div>
        <div className="mt-2 flex flex-col divide-y divide-muon-border/60 rounded-2xl border border-muon-border bg-muon-panel overflow-hidden">
          {[
            { l: 'Wan 2.5 · Neon alley test',        d: -15 },
            { l: 'Hailuo 02 · Sunset drift v2',      d: -20 },
            { l: 'CCTV night · refund',              d: +15, refund: true },
            { l: 'Nano Banana · Portrait warm',      d: -5  },
            { l: 'Plus renewal',                     d: +1000, topup: true },
          ].map((row, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5">
              <div className="text-[13px] truncate">{row.l}</div>
              <div className={`font-muon-mono text-[13px] font-bold muon-num ${
                row.refund ? 'text-muon-accent' : 'text-muon-money'
              }`}>
                {row.d > 0 ? '+' : ''}{row.d} cr
              </div>
            </div>
          ))}
        </div>
      </div>
      <MobileTabs />

      {/* ============ TOP-UP BOTTOM SHEET ============ */}
      {sheet && (
        <div className="absolute inset-0 z-40 bg-black/60 flex items-end" onClick={() => setSheet(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-muon-panel border-t border-muon-border rounded-t-3xl p-5 pb-8"
            style={{ animation: 'muonSlideUp 280ms ease-out' }}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-muon-border mb-4" />
            <div className="text-[18px] font-extrabold">Top up credits</div>
            <div className="text-[12px] text-muon-fg-muted mt-1">One-time. Credits never expire while your plan is active.</div>
            <div className="mt-4 flex flex-col gap-2">
              {TOPUPS.map((t) => (
                <button
                  key={t.cr}
                  className="flex items-center justify-between rounded-xl border border-muon-border bg-muon-base/60 px-4 py-3 hover:border-muon-money"
                >
                  <span className="font-muon-mono text-[16px] font-bold text-muon-money muon-num">+{t.cr} cr</span>
                  <span className="font-muon-mono text-[13px] font-bold">{t.price}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setSheet(false)}
              className="mt-4 w-full text-center text-[13px] text-muon-fg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
