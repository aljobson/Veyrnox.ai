// The word beside a gated model's name or price on the public lists. One
// style for all of them: it had drifted into three (11px, 12px bold, 13px
// bold). Amber, because premium is a money fact.
export function PremiumTag({ className = '' }) {
  return <span className={`text-[12px] font-bold text-vx-money ${className}`}>premium</span>;
}
