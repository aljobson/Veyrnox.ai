'use client';

import { useRef } from 'react';
import { Modal } from './Modal';
import { CharacterPortrait } from './OddlingPortrait';
import { chip } from './oddlingStyles';
import { CHARACTER_GROUPS, oddlingIdentity } from '../_lib/character';
import { characterOptionLabel } from '../_lib/characterOptions';

// The shared Modal supplies Escape, the focus trap, an inert page behind and
// focus returning to the card that opened it; mount this only while it is open.
export function OddlingSheet({ oddling, onClose, onRecreate, onAnimate }) {
  const closeRef = useRef(null);
  if (!oddling) return null;
  const picks = oddling.picks;
  const traits = CHARACTER_GROUPS.flatMap((group) => picks[group.id] ? [`${group.label}: ${characterOptionLabel(group.id, picks[group.id])}`] : []);
  const identity = oddlingIdentity(picks);
  return (
    <Modal onCancel={onClose} initialFocusRef={closeRef} aria-labelledby="character-sheet-title" className="items-center justify-center p-4 backdrop-blur-sm">
      <section className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="grid md:grid-cols-[.8fr_1.2fr] md:items-start">
          <div className="flex items-start justify-center bg-vx-base p-3 sm:p-4">
            <div className="w-full max-w-72"><CharacterPortrait oddling={oddling} /></div>
          </div>
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.15em] text-vx-accent">CHARACTER SHEET</span>
                <h2 id="character-sheet-title" className="vx-display mt-2 text-4xl">{oddling.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-vx-fg-body">{oddling.hook}</p>
              </div>
              <button ref={closeRef} type="button" onClick={onClose} aria-label="Close character sheet" className={chip(false)}>Close</button>
            </div>
            <div className="mt-6 space-y-4">
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">CREATOR PREMISE</span>
                <ul className="mt-2 space-y-1.5 text-sm text-vx-fg-body">
                  {identity.map((line) => <li key={line}>— {line}</li>)}
                </ul>
              </div>
              <div>
                <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">VISIBLE CANON</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {traits.map((line) => <span key={line} className="rounded-full bg-vx-fg/[0.06] px-2.5 py-1 text-[11px] text-vx-fg-muted">{line}</span>)}
                </div>
              </div>
            </div>
            <button type="button" onClick={() => onRecreate(oddling)} className="mt-7 w-full rounded-xl bg-vx-accent px-4 py-3 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
              Recreate as my own →
            </button>
            <button type="button" onClick={() => onAnimate(oddling)} className={`${chip(true)} mt-3 w-full`}>Animate this character</button>
          </div>
        </div>
      </section>
    </Modal>
  );
}
