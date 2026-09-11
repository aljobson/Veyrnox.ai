'use client';
import { useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';

const JOBS = [
  { id: 'j-01', name: 'Neon alley test',       model: 'Wan 2.5',           credits: 15,  status: 'done',    dur: '5s', when: '2 min ago',   bg: 'linear-gradient(135deg,#1b0632,#5a0e6a,#e4318f)' },
  { id: 'j-02', name: 'Sunset drift v2',       model: 'Hailuo 02',         credits: 20,  status: 'done',    dur: '5s', when: '14 min ago',  bg: 'linear-gradient(135deg,#2b1a0a,#7a4a1e,#f0b060)' },
  { id: 'j-03', name: 'Product cut — coffee',  model: 'Seedance 2.0 Fast', credits: 5,   status: 'running', dur: '5s', when: 'running',     bg: 'linear-gradient(135deg,#0a1a2c,#144a7a,#3ec1e8)' },
  { id: 'j-04', name: 'Portrait warm',         model: 'Nano Banana',       credits: 5,   status: 'done',    dur: '—',  when: '1 h ago',     bg: 'linear-gradient(160deg,#2c1a12,#7a3520,#c9713f)' },
  { id: 'j-05', name: 'CCTV night hero',       model: 'Wan 2.5',           credits: 15,  status: 'failed',  dur: '5s', when: '2 h ago',     bg: 'linear-gradient(180deg,#08120b,#0e3a1e,#2ea258)' },
  { id: 'j-06', name: 'Kling epic 10s',        model: 'Kling 3.0',         credits: 66,  status: 'done',    dur: '10s',when: '3 h ago',     bg: 'linear-gradient(135deg,#2b1a0a,#7a4a1e,#f0b060)' },
];

const STATUS = {
  done:    { chip: 'accent',  label: 'DONE' },
  running: { chip: 'accent',  label: 'RUNNING' },
  failed:  { chip: 'danger',  label: 'FAILED · REFUNDED' },
};

export default function Library() {
  const [tab, setTab] = useState('all');
  const list = tab === 'all' ? JOBS : JOBS.filter((j) => j.status === tab);

  return (
    <div className="min-h-dvh">
      <AppNav balance={823} active="library" />

      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-4">
        <Chip tone="accent" className="mb-3">LIBRARY · YOUR GENERATIONS</Chip>
        <h1 className="text-[40px] font-black tracking-[-0.02em]">Everything you've made</h1>
        <p className="text-vx-fg-body mt-2">Failed jobs refund automatically — they still show here so you can retry.</p>

        <div className="mt-6 flex gap-2">
          {['all', 'done', 'running', 'failed'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`font-vx-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-4 py-2 border ${
                tab === t
                  ? 'bg-vx-panel text-vx-fg border-vx-border'
                  : 'border-transparent text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((j) => {
            const s = STATUS[j.status];
            return (
              <div key={j.id} className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
                <div
                  className={`h-48 relative ${j.status === 'running' ? 'vx-shimmer' : ''}`}
                  style={{ background: j.bg }}
                >
                  <div className="absolute top-3 left-3">
                    <Chip tone={s.chip}>{s.label}</Chip>
                  </div>
                  <div className="absolute top-3 right-3 font-vx-mono text-[11px] font-bold text-white/85 bg-black/45 backdrop-blur rounded-full px-2.5 py-1 vx-num">
                    {j.dur}
                  </div>
                </div>
                <div className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{j.name}</div>
                    <div className="text-xs text-vx-fg-muted mt-0.5 truncate">{j.model} · {j.when}</div>
                  </div>
                  <div className="shrink-0 font-vx-mono text-[13px] font-bold vx-num pt-1">
                    <span className={j.status === 'failed' ? 'text-vx-accent' : 'text-vx-money'}>
                      {j.status === 'failed' ? `+${j.credits}` : `−${j.credits}`} cr
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
