'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LANDING_DRAFT_KEY } from '../_lib/landingDraft';

// The landing hero's working form: pick a model and a length, and the slip
// prints what the button will charge. Pressing Generate opens the studio on
// the same model and length, with the prompt carried over in sessionStorage
// (never in the URL, where it would land in logs and history).
//
// The price is the catalog row's credits, doubled for a 10 s video: the same
// rule app/create applies to the button it charges from. Nothing here is
// sold; the studio quotes again before it debits.

// Shown as one-tap chips when the live catalog has them. Everything else is
// one select away.
const FEATURED = ['wan-2.5-kie', 'kling-2.6-pro-kie', 'seedance-2.0-fast', 'nano-banana-pro-grsai', 'flux-2-pro'];

// The gateway refuses longer prompts (app/api/v1/generations/route.js).
const PROMPT_MAX = 2000;

const KIND_LABEL = { video: 'Video', image: 'Image', audio: 'Audio' };

function shortName(name) {
  return String(name || '').replace(/\s*\([^()]*\)\s*$/, '');
}

export function PriceSlip({ models }) {
  const router = useRouter();
  const open = useMemo(() => models.filter((m) => !m.gated), [models]);
  const chips = useMemo(
    () => FEATURED.map((id) => open.find((m) => m.id === id)).filter(Boolean),
    [open],
  );
  const [modelId, setModelId] = useState((chips[0] || open[0] || models[0])?.id);
  const [seconds, setSeconds] = useState(5);
  const [prompt, setPrompt] = useState('');

  const model = models.find((m) => m.id === modelId) || null;
  const lengths = model && model.kind === 'video' && model.durations?.length ? model.durations : [5];
  // A 10 s pick must not outlive a switch to a model that only sells 5 s.
  useEffect(() => {
    if (!lengths.includes(seconds)) setSeconds(lengths[0]);
  }, [lengths.join(','), seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!model) return null;
  const isVideo = model.kind === 'video';
  const cost = model.credits * (isVideo && seconds === 10 ? 2 : 1);
  const unit = isVideo ? `${seconds} s clip` : model.kind === 'audio' ? 'one clip' : 'one image';
  const inChips = chips.some((c) => c.id === model.id);

  function onSubmit(e) {
    e.preventDefault();
    try {
      window.sessionStorage.setItem(LANDING_DRAFT_KEY, JSON.stringify({ prompt: prompt.trim(), model: model.id, at: Date.now() }));
    } catch {
      // Private mode or storage off: the studio opens with its own sample prompt.
    }
    const qs = new URLSearchParams({ model: model.id });
    // The studio reads only 10s; 5s is its default.
    if (isVideo && seconds === 10) qs.set('duration', '10s');
    router.push(`/app/create?${qs.toString()}`);
  }

  return (
    <div className="relative">
      {/* The printer mouth the slip feeds out of. */}
      <div aria-hidden className="vx-slot mx-auto h-3 w-[calc(100%+12px)] -translate-x-[6px] rounded-full" />
      <div className="vx-paper-shadow -mt-1.5">
      <form onSubmit={onSubmit} className="vx-paper vx-print relative px-5 sm:px-7 pt-8 pb-9" aria-label="Price a generation">
        <label htmlFor="slip-prompt" className="block text-[13px] font-bold text-vx-fg">
          What should it make?
        </label>
        <textarea
          id="slip-prompt"
          rows={3}
          maxLength={PROMPT_MAX}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Slow push-in along a rain-soaked street at dusk, neon reflected in the puddles"
          className="mt-2 w-full resize-none rounded-lg border border-vx-border bg-vx-base px-3 py-2.5 text-[15px] leading-snug text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none"
        />

        <fieldset className="mt-4">
          <legend className="text-[13px] font-bold text-vx-fg">Model</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === model.id}
                onClick={() => setModelId(m.id)}
                className="vx-press rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
              >
                {shortName(m.name)}
              </button>
            ))}
            <select
              aria-label="Every other model"
              value={inChips ? '' : model.id}
              onChange={(e) => e.target.value && setModelId(e.target.value)}
              className={`rounded-full border bg-transparent px-3 py-1.5 text-[13px] font-semibold ${inChips ? 'border-vx-border text-vx-fg-muted' : 'border-vx-fg text-vx-fg'}`}
            >
              <option value="">{models.length - chips.length} more…</option>
              {['video', 'image', 'audio'].map((kind) => {
                const rows = models.filter((m) => m.kind === kind && !chips.includes(m));
                if (!rows.length) return null;
                return (
                  <optgroup key={kind} label={KIND_LABEL[kind]}>
                    {rows.map((m) => (
                      <option key={m.id} value={m.id}>
                        {shortName(m.name)}{m.gated ? ' (premium)' : ''}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        </fieldset>

        {lengths.length > 1 && (
          <fieldset className="mt-4">
            <legend className="text-[13px] font-bold text-vx-fg">Length</legend>
            <div className="mt-2 inline-flex rounded-full border border-vx-border p-0.5">
              {lengths.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={s === seconds}
                  onClick={() => setSeconds(s)}
                  className="vx-press rounded-full px-3.5 py-1 text-[13px] font-semibold text-vx-fg-body aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
                >
                  {s} s
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="vx-perf mt-6" aria-hidden />

        {/* One short announcement per change, not the whole slip re-read. */}
        <p className="sr-only" aria-live="polite">{`${shortName(model.name)}, ${unit}: ${cost} credits.`}</p>
        <dl className="mt-4 space-y-1.5 font-vx-mono text-[13px] vx-num">
          <SlipLine label={`${shortName(model.name)}, ${unit}`} value={`${cost} cr`} tick={`${model.id}-${seconds}`} />
          <SlipLine label="If it fails" value={`${cost} cr back`} muted tick={`${model.id}-${seconds}-r`} />
          {model.gated && <SlipLine label="Premium model" value="sign-up needed" muted />}
        </dl>

        <button
          type="submit"
          className="vx-press group mt-6 flex w-full items-center justify-between gap-4 rounded-xl bg-vx-accent px-5 py-4 text-left text-vx-accent-ink transition-colors hover:bg-vx-accent-hover"
        >
          <span className="text-[17px] font-extrabold">Generate</span>
          <span key={cost} className="vx-tick font-vx-mono text-[17px] font-bold vx-num">{cost} cr</span>
        </button>
        <p className="mt-3 text-[12.5px] leading-snug text-vx-fg-muted">
          Opens the studio with this model and prompt. It shows the same price before it charges.
        </p>
      </form>
      </div>
    </div>
  );
}

function SlipLine({ label, value, muted = false, tick }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className={`min-w-0 truncate ${muted ? 'text-vx-fg-muted' : 'text-vx-fg'}`}>{label}</dt>
      <span aria-hidden className="vx-leader flex-1" />
      <dd key={tick} className={`vx-tick shrink-0 ${muted ? 'text-vx-fg-muted' : 'font-bold text-vx-money'}`}>{value}</dd>
    </div>
  );
}
