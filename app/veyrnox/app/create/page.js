'use client';
import { useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { MODELS, ASPECT_RATIOS, DURATIONS, RESOLUTIONS } from '../../_lib/tokens';

export default function CreateStudio() {
  const [modelId, setModelId] = useState('wan-25');
  const [duration, setDuration] = useState('5s');
  const [aspect, setAspect] = useState('16:9');
  const [res, setRes] = useState('2K');
  const [prompt, setPrompt] = useState('A neon-lit Tokyo alley at 3am, low anamorphic tracking shot');
  const [generating, setGenerating] = useState(false);

  const model = MODELS.find((m) => m.id === modelId);
  const cost = model.credits * (duration === '10s' ? 2 : 1);
  const balance = 823;

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="create" />

      <div className="max-w-[1500px] mx-auto px-8 pt-6 pb-16 grid grid-cols-[1fr_360px] gap-6">
        {/* ============ CANVAS ============ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">STUDIO · UNTITLED</div>
              <h1 className="text-3xl font-black tracking-[-0.02em] mt-1">Create</h1>
            </div>
            <Chip tone="accent">AUTO-SAVING</Chip>
          </div>

          <div
            className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${generating ? 'vx-shimmer' : ''}`}
            style={{ aspectRatio: aspect.replace(':', '/') }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              {generating ? (
                <div className="text-center">
                  <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">GENERATING · WAN 2.5</div>
                  <div className="mt-2 font-vx-mono text-[42px] font-bold vx-num">18s</div>
                  <div className="text-xs text-vx-fg-muted mt-2">Refund on failure — always.</div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full border border-vx-border/60 flex items-center justify-center mx-auto opacity-70">
                    <div className="w-0 h-0 border-l-[16px] border-l-white border-y-[10px] border-y-transparent ml-1" />
                  </div>
                  <div className="mt-3 text-sm text-vx-fg-muted">Type a prompt or pick a preset</div>
                </div>
              )}
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-3 w-full bg-vx-panel border border-vx-border rounded-lg p-3.5 text-sm text-vx-fg placeholder:text-vx-fg-faint resize-none focus:outline-none focus:border-vx-accent"
            placeholder="Describe the shot…"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <Chip tone="accent">WAN 2.5 · RECOMMENDED</Chip>
            {['Cinematic', 'Handheld', 'Zoom in', 'Golden hour', 'Rain'].map((t) => (
              <button key={t} className="font-vx-mono text-[10px] tracking-[0.12em] font-bold rounded-full px-3 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg">
                + {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* ============ CONTROLS ============ */}
        <aside className="flex flex-col gap-5">
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">MODEL</div>
            <div className="flex flex-col gap-1.5">
              {MODELS.filter((m) => m.kind === 'video').map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${
                    modelId === m.id
                      ? 'border-vx-accent bg-vx-accent/[0.07]'
                      : 'border-transparent hover:bg-white/[0.03]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-bold">{m.name}</span>
                    {m.tag && (
                      <span className={`font-vx-mono text-[8.5px] tracking-[0.1em] ${
                        m.premium ? 'text-vx-money' : 'text-vx-fg-muted'
                      }`}>{m.premium ? '◆ ' : ''}{m.tag}</span>
                    )}
                  </span>
                  <span className="font-vx-mono text-[12px] font-bold text-vx-money vx-num">{m.credits} cr</span>
                </button>
              ))}
            </div>
          </div>

          <ControlRow label="DURATION" options={DURATIONS} value={duration} onChange={setDuration} />
          <ControlRow label="ASPECT"   options={ASPECT_RATIOS} value={aspect} onChange={setAspect} />
          <ControlRow label="QUALITY"  options={RESOLUTIONS} value={res} onChange={setRes} />

          <div className="mt-2 rounded-2xl border border-vx-border bg-vx-panel p-5">
            <div className="flex items-baseline justify-between">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">TOTAL COST</span>
              <span className="font-vx-mono text-[12px] text-vx-fg-muted vx-num">balance {balance} cr</span>
            </div>
            <div className="mt-1 font-vx-mono text-[36px] font-bold text-vx-money vx-num">−{cost} cr</div>
            <button
              onClick={() => setGenerating((g) => !g)}
              className="mt-4 w-full flex items-center justify-between bg-vx-accent text-vx-accent-ink rounded-full px-6 py-3.5 font-extrabold hover:bg-vx-accent-hover disabled:opacity-40"
              disabled={cost > balance}
            >
              <span>{generating ? 'Cancel' : 'Generate'}</span>
              <span className="font-vx-mono text-sm">−{cost} cr</span>
            </button>
            <div className="mt-2 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-faint text-center">
              REFUND ON FAILURE · ALWAYS
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ControlRow({ label, options, value, onChange }) {
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
              value === o
                ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]'
                : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
