'use client';
import { useEffect, useRef } from 'react';
import { PRESETS } from '../../../../../lib/musicInstruments.js';
import { WAVETABLE_PRESETS } from '../../../_lib/music/beat/beatWavetable.js';
import { createBeatEngine } from '../../../_lib/music/beat/beatEngine.js';
import { button } from './beatStyles';
export default function BeatInstrumentLibrary({ onAdd, announce, query }) {
  const engine = useRef(null);
  useEffect(() => {
    const close = () => { engine.current?.close().catch(() => {}); engine.current = null; };
    window.addEventListener('pagehide', close); return () => { close(); window.removeEventListener('pagehide', close); };
  }, []);
  async function audition(instrument) {
    try {
      engine.current ||= createBeatEngine(); const instance = engine.current; await instance.resume();
      if (instance !== engine.current) return;
      const track = { id: 'audition', instrument, gain: 1, pan: 0 };
      for (const [index, pitch] of (instrument.id === 'drums' ? [36, 38, 42, 46] : [48, 52, 55, 60]).entries()) {
        const at = instance.now() + index * 0.18;
        instance.playMidi(track, pitch, 100, at).release(at + 0.25);
      }
    } catch (e) { announce(e.message); }
  }
  const groups = [...Object.entries(PRESETS), ['wavetable', Object.entries(WAVETABLE_PRESETS).map(([id, p]) => ({ id, label: p.label }))]];
  return <div className="max-h-[60vh] space-y-3 overflow-y-auto">{groups.map(([id, presets]) => <section key={id} aria-label={id}><h3 className="font-bold capitalize">{id}</h3>{presets.filter((p) => `${id} ${p.label}`.toLowerCase().includes(query.toLowerCase())).map((preset) => {
    const instrument = { engine: id === 'wavetable' ? 'wavetable' : 'voice', id, preset: preset.id };
    return <div key={preset.id} className="flex flex-wrap items-center gap-1 border-b border-vx-border py-2"><span className="w-full">{preset.label}</span><button className={button} aria-label={`Audition ${preset.label}`} onClick={() => audition(instrument)}>Audition</button><button className={button} aria-label={`Add ${preset.label}`} onClick={() => onAdd(instrument)}>Add</button></div>;
  })}</section>)}</div>;
}
