// Balance pill — amber credit counter, tabular numerals. Optional ± tick animation.
export function BalancePill({ balance, tick, tickTone = 'money' }) {
  const fmt = new Intl.NumberFormat('en-US').format(balance);
  return (
    <span className="relative inline-flex items-center gap-2 rounded-full border border-muon-border bg-muon-panel px-3 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-muon-money" />
      <span className="font-muon-mono text-[12px] font-bold text-muon-money muon-num">{fmt} cr</span>
      {tick && (
        <span
          className={`absolute -top-3 right-2 font-muon-mono text-[11px] font-bold ${
            tickTone === 'danger' ? 'text-muon-danger' : 'text-muon-money'
          }`}
          style={{ animation: 'muonTickUp 1.8s ease-out' }}
        >
          {tick}
        </span>
      )}
    </span>
  );
}
