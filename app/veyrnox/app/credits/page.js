'use client';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { PLANS } from '../../_lib/tokens';

const LEDGER = [
  { when: '09:41 · today', label: 'Wan 2.5 · Neon alley test',      delta: -15, kind: 'spend' },
  { when: '09:12 · today', label: 'Hailuo 02 · Sunset drift v2',    delta: -20, kind: 'spend' },
  { when: '08:55 · today', label: 'CCTV night hero (failed) · refund', delta: +15, kind: 'refund' },
  { when: 'Yesterday',     label: 'Nano Banana · Portrait warm',    delta: -5,  kind: 'spend' },
  { when: '3 Sep',         label: 'Monthly credits · Plus plan',    delta: +1000, kind: 'top-up' },
  { when: '3 Sep',         label: 'Top-up · $9 · 300 credits',      delta: +300, kind: 'top-up' },
];

export default function Credits() {
  const balance = 823;

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="credits" />

      <section className="max-w-[1200px] mx-auto px-8 pt-10 pb-8">
        <Chip tone="money" className="mb-3">CREDITS & BILLING</Chip>
        <h1 className="text-[40px] font-black tracking-[-0.02em]">Your balance</h1>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-8">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">CURRENT BALANCE</div>
            <div className="mt-1 font-vx-mono text-[72px] font-bold text-vx-money leading-none vx-num">
              {new Intl.NumberFormat('en-US').format(balance)}
              <span className="text-2xl align-middle ml-2 text-vx-fg-muted">cr</span>
            </div>
            <div className="mt-4 text-sm text-vx-fg-body">
              Renews <b>3 Oct</b> · <b>1,000 cr</b> on the Plus plan.
              Unused credits don't roll over.
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {[
                { c: 300, price: '$9' },
                { c: 750, price: '$19' },
                { c: 2000, price: '$49' },
              ].map((t) => (
                <button
                  key={t.c}
                  className="flex flex-col items-start rounded-xl border border-vx-border bg-vx-base/60 px-4 py-3 hover:border-vx-money"
                >
                  <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">TOP-UP</span>
                  <span className="font-vx-mono text-[18px] font-bold text-vx-money mt-1 vx-num">+{t.c} cr</span>
                  <span className="font-vx-mono text-[12px] text-vx-fg-body mt-1">{t.price}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-vx-border bg-vx-panel p-6 flex flex-col">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">YOUR PLAN</div>
            <div className="mt-1 text-2xl font-black">Plus · $39/mo</div>
            <ul className="mt-4 space-y-2 text-sm text-vx-fg-body flex-1">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> 1,000 cr / month</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Premium models unlocked</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Priority queue</li>
            </ul>
            <div className="flex gap-2 mt-5">
              <button className="flex-1 rounded-full border border-vx-border text-vx-fg text-xs font-bold py-2.5 hover:border-vx-accent">
                Change plan
              </button>
              <button className="flex-1 rounded-full border border-vx-border text-vx-fg-muted text-xs font-bold py-2.5 hover:border-vx-danger hover:text-vx-danger">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ LEDGER ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-16">
        <h2 className="text-xl font-black tracking-[-0.02em] mb-4">Credit ledger</h2>
        <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
          {LEDGER.map((l, i) => (
            <div
              key={i}
              className="grid grid-cols-[160px_1fr_120px] items-center px-5 py-3 border-b border-vx-border/60 last:border-b-0"
            >
              <div className="font-vx-mono text-[11px] tracking-[0.06em] text-vx-fg-muted">{l.when}</div>
              <div className="text-sm">{l.label}</div>
              <div className={`text-right font-vx-mono text-[14px] font-bold vx-num ${
                l.delta > 0 ? (l.kind === 'refund' ? 'text-vx-accent' : 'text-vx-money') : 'text-vx-money'
              }`}>
                {l.delta > 0 ? '+' : ''}{l.delta} cr
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
