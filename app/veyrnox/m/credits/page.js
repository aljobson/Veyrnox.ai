'use client';
import Link from '../../../../components/NavigationLink';
import { MobileTabs } from '../_MobileNav';
import { Chip } from '../../_components/Chip';

// Top-ups are bought on the web credits page, which reads pack prices from
// the catalog; nothing is priced here.
export default function MobileCredits() {
  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div className="flex-1 overflow-y-auto p-[14px_18px_16px]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">Credits</span>
          <Chip tone="money">NO TIERS</Chip>
        </div>

        <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
          <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">CURRENT BALANCE</div>
          <div className="font-vx-mono text-[52px] font-bold text-vx-money leading-none mt-1 vx-num">
            823<span className="text-lg text-vx-fg-muted ml-1.5">cr</span>
          </div>
          <div className="text-[12px] text-vx-fg-body mt-3">
            Every account runs on the same balance. Failed jobs refund automatically.
          </div>
          <Link
            href="/app/credits"
            className="mt-4 w-full flex justify-center items-center bg-vx-money text-vx-money-ink rounded-full py-3 text-[14px] font-extrabold"
          >
            Top up
          </Link>
        </div>

        <div className="mt-5 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">RECENT</div>
        <div className="mt-2 flex flex-col divide-y divide-vx-border/60 rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
          {[
            { l: 'Wan 2.5 · Neon alley test',        d: -16 },
            { l: 'MiniMax Hailuo 02 · Sunset drift', d: -14 },
            { l: 'CCTV night · refund',              d: +15, refund: true },
            { l: 'Nano Banana · Portrait warm',      d: -3  },
          ].map((row, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5">
              <div className="text-[13px] truncate">{row.l}</div>
              <div className={`font-vx-mono text-[13px] font-bold vx-num ${
                row.refund ? 'text-vx-accent' : 'text-vx-money'
              }`}>
                {row.d > 0 ? '+' : ''}{row.d} cr
              </div>
            </div>
          ))}
        </div>
      </div>
      <MobileTabs />
    </div>
  );
}
