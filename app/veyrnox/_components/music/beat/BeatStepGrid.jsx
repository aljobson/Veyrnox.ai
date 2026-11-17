'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { DRUM_PADS } from '../../../../../lib/musicInstruments.js';
import { toggleStep, cycleVelocity } from '../../../_lib/music/beat/beatOps.mjs';
import { button } from './beatStyles';

export default function BeatStepGrid({ doc, edit, playhead, runId }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [paging, setPaging] = useState({ page: 0, manualRun: null });
  const [focus, setFocus] = useState({ row: 0, step: 0 });
  const focusPending = useRef(false);
  const cells = useRef(new Map());
  const press = useRef({});
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const change = () => setPhone(media.matches);
    media.addEventListener('change', change);
    return () => { media.removeEventListener('change', change); clearTimeout(press.current.timer); };
  }, []);
  const following = runId !== null && paging.manualRun !== runId && playhead >= 0;
  const page = Math.min(Math.floor((doc.steps - 1) / 8), following ? Math.floor(playhead / 8) : paging.page);
  const start = phone ? page * 8 : 0;
  const count = phone ? 8 : doc.steps;
  const visible = Array.from({ length: count }, (_, i) => start + i);
  const focusStep = focus.step >= start && focus.step < start + count ? focus.step : start;
  useEffect(() => {
    if (focusPending.current) { cells.current.get(`${focus.row}:${focus.step}`)?.focus(); focusPending.current = false; }
  }, [focus, page, phone]);
  function move(e, row, step) {
    const directions = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (directions[e.key]) {
      e.preventDefault();
      const [dr, ds] = directions[e.key];
      const next = { row: (row + dr + 8) % 8, step: (step + ds + doc.steps) % doc.steps };
      focusPending.current = true; setFocus(next);
      setPaging({ page: Math.floor(next.step / 8), manualRun: runId });
    } else if (['+', '=', '-'].includes(e.key)) {
      e.preventDefault(); edit((d) => cycleVelocity(d, DRUM_PADS[row].id, step, e.key === '-' ? -1 : 1), { label: BEAT_ACTIONS.a25 });
    }
  }
  function pageBy(delta) {
    setPaging({ page: Math.max(0, Math.min(doc.steps / 8 - 1, page + delta)), manualRun: runId });
  }
  return <section id="beat-pattern" role="tabpanel" aria-labelledby={`pattern-${doc.currentPattern}`} className="min-w-0 space-y-3">
    <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.tap.to.toggle.shift.click.or.hold.to.change.velocity.arrow.keys.move.a')}</p>
    {phone && <div className="flex items-center justify-between gap-2"><button className={button} disabled={page === 0} onClick={() => pageBy(-1)}>{t('app.music.beat.ui.previous')}</button><span className="text-sm">{t('app.music.beat.ui.steps')}{start + 1}–{start + 8}</span><button className={button} disabled={page === doc.steps / 8 - 1} onClick={() => pageBy(1)}>{t('app.music.beat.next')}</button></div>}
    <div dir="ltr" role="grid" aria-label={t('app.music.beat.labels.l35', { p0: doc.currentPattern })} aria-rowcount={8} aria-colcount={doc.steps + 1} className="max-w-full overflow-x-auto rounded-xl border border-vx-border bg-vx-panel">
      {DRUM_PADS.map((pad, row) => <div key={pad.id} role="row" aria-rowindex={row + 1} className={phone ? 'w-full' : 'w-max min-w-full'}>
        <div role="rowheader" aria-colindex={1} className="px-2 py-1 text-xs font-bold text-vx-fg-body">{pad.label}</div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(44px, 1fr))` }}>
          {visible.map((step) => {
            const velocity = doc.patterns[doc.currentPattern].rows[pad.id]?.find(([s]) => s === step)?.[1];
            const lit = playhead === step;
            return <div key={step} role="gridcell" aria-colindex={step + 2}>
              <button data-beat-tip="grid" type="button" ref={(node) => { const key = `${row}:${step}`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
                aria-pressed={Boolean(velocity)} aria-label={t('app.music.beat.labels.l36', { p0: pad.label, p1: step + 1, p2: velocity ? t('app.music.beat.labels.l37', { p0: velocity }) : t('app.music.beat.ui.off') })}
                tabIndex={row === focus.row && step === focusStep ? 0 : -1} onFocus={() => setFocus({ row, step })}
                className={`relative block h-11 min-w-11 w-full border border-vx-border text-xs font-bold focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent ${step % 4 === 0 ? 'border-l-2 border-l-vx-fg-muted' : ''} ${lit ? 'ring-2 ring-inset ring-vx-accent' : ''} ${velocity === 127 ? 'bg-vx-hue-iris/60' : velocity === 100 ? 'bg-vx-hue-iris/35' : velocity === 60 ? 'bg-vx-hue-iris/15' : 'bg-vx-base'} text-vx-fg`}
                onKeyDown={(e) => move(e, row, step)}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  clearTimeout(press.current.timer);
                  press.current = { x: e.clientX, y: e.clientY, suppress: false, timer: setTimeout(() => {
                    press.current.suppress = true; edit((d) => cycleVelocity(d, pad.id, step), { label: BEAT_ACTIONS.a25 });
                  }, 450) };
                }}
                onPointerMove={(e) => {
                  if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) { clearTimeout(press.current.timer); press.current.suppress = true; }
                }}
                onPointerUp={() => clearTimeout(press.current.timer)}
                onPointerCancel={() => { clearTimeout(press.current.timer); press.current.suppress = true; }}
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => {
                  if (e.detail !== 0 && press.current.suppress) { press.current.suppress = false; return; }
                  edit((d) => e.shiftKey ? cycleVelocity(d, pad.id, step) : toggleStep(d, pad.id, step), { label: e.shiftKey ? BEAT_ACTIONS.a25 : BEAT_ACTIONS.step });
                }}>
                <span aria-hidden="true">{step + 1}{velocity === 60 ? t('app.music.beat.ui.s.2') : velocity === 127 ? t('app.music.beat.ui.h') : ''}</span>
              </button>
            </div>;
          })}
        </div>
      </div>)}
    </div>
    <button className={button} onClick={() => edit(d => cycleVelocity(d, DRUM_PADS[focus.row].id, focusStep), { label: BEAT_ACTIONS.a25 })}>{t('app.music.beat.control.stepVelocity')}</button>
    <p className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.s.soft.h.hard.unmarked.active.steps.medium')}</p>
  </section>;
}
