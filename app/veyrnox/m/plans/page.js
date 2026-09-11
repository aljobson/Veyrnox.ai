import Link from 'next/link';
import { Logo } from '../../_components/Logo';
import { Chip } from '../../_components/Chip';
import { PLANS } from '../../_lib/tokens';

export default function MobilePlans() {
  return (
    <div className="flex-1 flex flex-col p-[18px] overflow-y-auto">
      <div className="flex items-center gap-2.5">
        <Logo size={28} />
        <span className="text-[22px] font-extrabold tracking-[-0.02em]">Pick your plan</span>
      </div>
      <p className="text-[13px] text-vx-fg-muted mt-2 leading-[1.5]">
        Credits buy generations. Every model shows its price before you spend.
      </p>

      <div className="flex flex-col gap-2.5 mt-4">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className={`relative rounded-2xl border p-4 ${
              p.hot ? 'border-vx-money bg-vx-panel' : 'border-vx-border bg-vx-panel'
            }`}
          >
            {p.hot && (
              <span className="absolute -top-2 right-3.5">
                <Chip tone="solid">MOST PICKED</Chip>
              </span>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-[17px] font-extrabold">{p.name}</span>
              <span className="font-vx-mono text-[14px] font-bold vx-num">${p.priceMo}<span className="text-[10px] text-vx-fg-muted">/mo</span></span>
            </div>
            <div className="font-vx-mono text-[12px] font-bold text-vx-money mt-1 vx-num">{p.creditsFmt} / month</div>
            <div className="text-[11.5px] text-vx-fg-muted mt-1">{p.equivalence}</div>
          </div>
        ))}
      </div>

      <div className="flex-1" />

      <Link
        href="/veyrnox/m/create"
        className="mt-4 flex justify-center items-center bg-vx-money text-vx-money-ink rounded-full py-3.5 text-[15px] font-extrabold min-h-[50px]"
      >
        Continue with Plus
      </Link>
      <div className="font-vx-mono text-[8.5px] tracking-[0.1em] text-vx-fg-faint text-center mt-2.5">
        CREDITS RESET MONTHLY · NO ROLLOVER · CANCEL ANYTIME
      </div>
    </div>
  );
}
