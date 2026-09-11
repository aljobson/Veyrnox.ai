import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';

const KPIS = [
  { label: 'Active users · 24h',   value: '3,124',  delta: '+8.2%', tone: 'accent' },
  { label: 'Credits burned · 24h', value: '148,220', delta: '+11.4%', tone: 'money' },
  { label: 'Failure rate',         value: '2.1%',   delta: '−0.4pp', tone: 'accent' },
  { label: 'Refunds · 24h',        value: '3,110 cr', delta: '−7.9%', tone: 'accent' },
];

const BREAKERS = [
  { model: 'Wan 2.5',           state: 'ok',     latency: '18.2s', failure: '1.8%' },
  { model: 'Veo 3.1',           state: 'ok',     latency: '42.1s', failure: '3.1%' },
  { model: 'Kling 3.0',         state: 'degraded', latency: '58.4s', failure: '6.7%' },
  { model: 'Seedance 2.0 Fast', state: 'ok',     latency: '9.2s',  failure: '0.9%' },
  { model: 'Hailuo 02',         state: 'ok',     latency: '22.8s', failure: '2.4%' },
  { model: 'Nano Banana',       state: 'ok',     latency: '3.1s',  failure: '0.4%' },
];

export default function Admin() {
  return (
    <div className="min-h-dvh">
      <AppNav balance={823} active="explore" />

      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-6">
        <Chip tone="danger" className="mb-3">ADMIN · OPS DASHBOARD</Chip>
        <h1 className="text-[36px] font-black tracking-[-0.02em]">Live health</h1>

        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-[10px] border border-vx-border bg-vx-panel p-4">
              <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted">{k.label.toUpperCase()}</div>
              <div className="mt-1 font-vx-mono text-[26px] font-bold vx-num">{k.value}</div>
              <div className={`font-vx-mono text-[11px] font-bold mt-0.5 vx-num ${
                k.tone === 'money' ? 'text-vx-money' : 'text-vx-accent'
              }`}>{k.delta}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Model circuit breakers</h2>
        <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_140px_140px_120px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>MODEL</div><div>STATE</div><div className="text-right">P95 LATENCY</div><div className="text-right">FAILURE RATE</div><div className="text-right">ACTION</div>
          </div>
          {BREAKERS.map((b) => (
            <div key={b.model} className="grid grid-cols-[1fr_120px_140px_140px_120px] items-center px-5 py-3 border-b border-vx-border/60 last:border-b-0">
              <div className="text-sm font-bold">{b.model}</div>
              <div>
                <span className={`font-vx-mono text-[10px] tracking-[0.1em] font-bold ${
                  b.state === 'ok' ? 'text-vx-accent' : 'text-vx-money'
                }`}>{b.state.toUpperCase()}</span>
              </div>
              <div className="text-right font-vx-mono text-sm vx-num">{b.latency}</div>
              <div className="text-right font-vx-mono text-sm vx-num">{b.failure}</div>
              <div className="text-right">
                <button className="font-vx-mono text-[10px] tracking-[0.1em] font-bold text-vx-danger hover:brightness-110">
                  OPEN BREAKER
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
