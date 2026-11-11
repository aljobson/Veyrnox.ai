'use client';

import { useEffect, useRef, useState } from 'react';

const TYPING_NOTES = Object.freeze({ a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74, p: 75, ';': 76 });
const NOTE_NAMES = Object.freeze(['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
const MAX_NOTES = 64;
const MAX_VOICES = 12;
const KEYBOARD_NOTES = Object.freeze([60, 62, 64, 65, 67, 69, 71, 72]);
const WAVETABLES = Object.freeze({
  pure: Object.freeze([0, 1]),
  warm: Object.freeze([0, 1, 0.42, 0.18, 0.08, 0.04]),
  bright: Object.freeze([0, 1, 0.72, 0.5, 0.34, 0.24, 0.17, 0.12]),
  hollow: Object.freeze([0, 1, 0, 0.42, 0, 0.2, 0, 0.1]),
});
const SYNTH_PRESETS = Object.freeze({
  glass: Object.freeze({ label: 'Glass keys', tableA: 'pure', tableB: 'bright', morph: 0.28, cutoff: 7600, resonance: 1.4, attack: 0.01, release: 0.38, lfoRate: 0.35, lfoDepth: 0.05 }),
  pad: Object.freeze({ label: 'Warm pad', tableA: 'warm', tableB: 'hollow', morph: 0.58, cutoff: 3200, resonance: 2.1, attack: 0.42, release: 1.25, lfoRate: 0.22, lfoDepth: 0.18 }),
  bass: Object.freeze({ label: 'Pulse bass', tableA: 'bright', tableB: 'hollow', morph: 0.72, cutoff: 980, resonance: 5.5, attack: 0.005, release: 0.18, lfoRate: 2.4, lfoDepth: 0.08 }),
});

function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function bounded(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function MusicStudioMidi({ tempo, playheadSeconds }) {
  const [notes, setNotes] = useState([]);
  const [typing, setTyping] = useState(false);
  const [octave, setOctave] = useState(0);
  const [velocity, setVelocity] = useState(96);
  const [presetId, setPresetId] = useState('glass');
  const [tableA, setTableA] = useState(SYNTH_PRESETS.glass.tableA);
  const [tableB, setTableB] = useState(SYNTH_PRESETS.glass.tableB);
  const [morph, setMorph] = useState(SYNTH_PRESETS.glass.morph);
  const [cutoff, setCutoff] = useState(SYNTH_PRESETS.glass.cutoff);
  const [resonance, setResonance] = useState(SYNTH_PRESETS.glass.resonance);
  const [attack, setAttack] = useState(SYNTH_PRESETS.glass.attack);
  const [release, setRelease] = useState(SYNTH_PRESETS.glass.release);
  const [lfoRate, setLfoRate] = useState(SYNTH_PRESETS.glass.lfoRate);
  const [lfoDepth, setLfoDepth] = useState(SYNTH_PRESETS.glass.lfoDepth);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [midiInputs, setMidiInputs] = useState([]);
  const [midiInputId, setMidiInputId] = useState('');
  const [midiMessage, setMidiMessage] = useState('External MIDI permission starts only after you choose Enable external MIDI.');
  const contextRef = useRef(null);
  const voicesRef = useRef(new Map());
  const pendingRef = useRef(new Map());
  const captureStartedRef = useRef(0);
  const captureBeatRef = useRef(0);
  const midiObjectsRef = useRef(new Map());
  const midiAccessRef = useRef(null);
  const noteOnRef = useRef(null);
  const noteOffRef = useRef(null);

  useEffect(() => () => {
    voicesRef.current.forEach((voice) => voice.stopNow());
    voicesRef.current.clear();
    midiObjectsRef.current.forEach((input) => { input.onmidimessage = null; });
    if (midiAccessRef.current) midiAccessRef.current.onstatechange = null;
    contextRef.current?.close?.();
  }, []);

  function addCapturedNote(pitch, start, length, nextVelocity) {
    setNotes((current) => current.length >= MAX_NOTES ? current : [...current, {
      id: crypto.randomUUID(),
      pitch: Math.round(bounded(pitch, 24, 108, 60)),
      start: bounded(start, 0, 128, 0),
      length: bounded(length, 0.125, 16, 0.25),
      velocity: Math.round(bounded(nextVelocity, 1, 127, 96)),
    }]);
  }

  function ensureContext() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    contextRef.current ||= new Context();
    contextRef.current.resume?.();
    return contextRef.current;
  }

  function makePeriodicWave(context, name) {
    const imag = Float32Array.from(WAVETABLES[name] || WAVETABLES.pure);
    return context.createPeriodicWave(new Float32Array(imag.length), imag, { disableNormalization: false });
  }

  function stopNodes(nodes, when) {
    nodes.forEach((item) => { try { item.stop(when); } catch {} });
  }

  function createVoice(pitch, nextVelocity, startAt, endAt = null) {
    const context = ensureContext();
    if (!context?.createPeriodicWave) return null;
    try {
      const oscillatorA = context.createOscillator();
      const oscillatorB = context.createOscillator();
      const gainA = context.createGain();
      const gainB = context.createGain();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      const frequency = 440 * (2 ** ((pitch - 69) / 12));
      const peak = Math.max(0.0001, (nextVelocity / 127) * 0.09);
      oscillatorA.setPeriodicWave(makePeriodicWave(context, tableA));
      oscillatorB.setPeriodicWave(makePeriodicWave(context, tableB));
      oscillatorA.frequency.setValueAtTime(frequency, startAt);
      oscillatorB.frequency.setValueAtTime(frequency, startAt);
      gainA.gain.setValueAtTime(1 - morph, startAt);
      gainB.gain.setValueAtTime(morph, startAt);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, startAt);
      filter.Q.setValueAtTime(resonance, startAt);
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.linearRampToValueAtTime(peak, startAt + attack);
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(lfoRate, startAt);
      lfoGain.gain.setValueAtTime(cutoff * lfoDepth, startAt);
      oscillatorA.connect(gainA).connect(filter);
      oscillatorB.connect(gainB).connect(filter);
      filter.connect(envelope).connect(context.destination);
      lfo.connect(lfoGain).connect(filter.frequency);
      const sources = [oscillatorA, oscillatorB, lfo];
      sources.forEach((item) => item.start(startAt));
      const finishAt = (when) => {
        const stopAt = when + release + 0.05;
        envelope.gain.cancelScheduledValues(when);
        envelope.gain.setTargetAtTime(0.0001, when, Math.max(0.005, release / 3));
        stopNodes(sources, stopAt);
      };
      if (Number.isFinite(endAt)) finishAt(endAt);
      return { stop: () => finishAt(context.currentTime), stopNow: () => stopNodes(sources, context.currentTime) };
    } catch { return null; }
  }

  function applyPreset(id) {
    const preset = SYNTH_PRESETS[id];
    if (!preset) return;
    setPresetId(id); setTableA(preset.tableA); setTableB(preset.tableB); setMorph(preset.morph);
    setCutoff(preset.cutoff); setResonance(preset.resonance); setAttack(preset.attack); setRelease(preset.release);
    setLfoRate(preset.lfoRate); setLfoDepth(preset.lfoDepth);
  }

  function noteOn(key, pitch, nextVelocity) {
    if (voicesRef.current.has(key)) return;
    if (voicesRef.current.size >= MAX_VOICES) {
      const [oldestKey, oldestVoice] = voicesRef.current.entries().next().value || [];
      oldestVoice?.stop(); voicesRef.current.delete(oldestKey);
    }
    const context = ensureContext();
    const voice = context ? createVoice(pitch, nextVelocity, context.currentTime) : null;
    if (voice) voicesRef.current.set(key, voice);
    if (capturing && !pendingRef.current.has(key)) {
      const elapsedBeats = ((performance.now() - captureStartedRef.current) / 60_000) * tempo;
      pendingRef.current.set(key, { pitch, start: captureBeatRef.current + elapsedBeats, velocity: nextVelocity, at: performance.now() });
    }
  }

  function noteOff(key) {
    const voice = voicesRef.current.get(key);
    if (voice) {
      voice.stop();
      voicesRef.current.delete(key);
    }
    const pending = pendingRef.current.get(key);
    if (pending) {
      const length = Math.max(0.125, ((performance.now() - pending.at) / 60_000) * tempo);
      addCapturedNote(pending.pitch, pending.start, length, pending.velocity);
      pendingRef.current.delete(key);
    }
  }

  useEffect(() => {
    noteOnRef.current = noteOn;
    noteOffRef.current = noteOff;
  });

  function handleTypingDown(event) {
    if (!typing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'x') {
      event.preventDefault();
      setOctave((current) => Math.max(-2, Math.min(2, current + (key === 'x' ? 1 : -1))));
      return;
    }
    if (key === 'c' || key === 'v') {
      event.preventDefault();
      setVelocity((current) => Math.max(16, Math.min(127, current + (key === 'v' ? 8 : -8))));
      return;
    }
    if (TYPING_NOTES[key] === undefined) return;
    event.preventDefault();
    noteOn(`typing:${key}`, TYPING_NOTES[key] + octave * 12, velocity);
  }

  function handleTypingUp(event) {
    if (!typing) return;
    const key = event.key.toLowerCase();
    if (TYPING_NOTES[key] === undefined) return;
    event.preventDefault();
    noteOff(`typing:${key}`);
  }

  function updateNote(id, field, value) {
    setNotes((current) => current.map((note) => note.id === id ? {
      ...note,
      [field]: field === 'pitch' || field === 'velocity'
        ? Math.round(bounded(value, field === 'pitch' ? 24 : 1, field === 'pitch' ? 108 : 127, note[field]))
        : bounded(value, field === 'length' ? 0.125 : 0, field === 'length' ? 16 : 128, note[field]),
    } : note));
  }

  function addNote() {
    const start = notes.reduce((latest, note) => Math.max(latest, note.start + note.length), 0);
    addCapturedNote(60, start, 1, velocity);
  }

  function quantize() {
    setNotes((current) => current.map((note) => ({ ...note, start: Math.round(note.start * 4) / 4, length: Math.max(0.25, Math.round(note.length * 4) / 4) })));
  }

  function playSequence() {
    const context = ensureContext();
    if (!context) return;
    notes.forEach((note) => {
      const start = context.currentTime + (note.start * 60) / tempo;
      const end = start + (note.length * 60) / tempo;
      createVoice(note.pitch, note.velocity, start, end);
    });
  }

  function toggleCapture() {
    if (capturing) {
      pendingRef.current.forEach((_, key) => noteOff(key));
      setCapturing(false);
      return;
    }
    captureStartedRef.current = performance.now();
    captureBeatRef.current = (Number(playheadSeconds) || 0) * tempo / 60;
    pendingRef.current.clear();
    setCapturing(true);
  }

  function refreshMidiInputs(access) {
    const found = Array.from(access.inputs?.values?.() || []).map((input, index) => ({ id: input.id, label: input.name || `MIDI input ${index + 1}` }));
    midiObjectsRef.current = new Map(Array.from(access.inputs?.values?.() || []).map((input) => [input.id, input]));
    setMidiInputs(found);
    setMidiInputId((current) => found.some((input) => input.id === current) ? current : (found[0]?.id || ''));
    setMidiMessage(found.length ? 'MIDI input ready. Notes stay local to this tab.' : 'MIDI permission granted, but no input device is connected.');
  }

  async function enableExternalMidi() {
    if (typeof navigator.requestMIDIAccess !== 'function') {
      setMidiMessage('Web MIDI is unavailable in this browser. Use musical typing instead; Safari does not expose Web MIDI.');
      return;
    }
    setMidiMessage('Requesting MIDI device permission…');
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      refreshMidiInputs(access);
      access.onstatechange = () => refreshMidiInputs(access);
    } catch {
      setMidiMessage('MIDI permission was denied. Musical typing remains available.');
    }
  }

  useEffect(() => {
    midiObjectsRef.current.forEach((input) => { input.onmidimessage = null; });
    const input = midiObjectsRef.current.get(midiInputId);
    if (!input) return undefined;
    input.onmidimessage = (event) => {
      const [status = 0, pitch = 0, nextVelocity = 0] = Array.from(event.data || []);
      const command = status & 0xf0;
      const key = `midi:${pitch}`;
      if (command === 0x90 && nextVelocity > 0) noteOnRef.current?.(key, pitch, nextVelocity);
      if (command === 0x80 || (command === 0x90 && nextVelocity === 0)) noteOffRef.current?.(key);
    };
    return () => { input.onmidimessage = null; };
  }, [midiInputId, midiInputs]);

  return (
    <section aria-label="Studio MIDI track" tabIndex="0" onKeyDown={handleTypingDown} onKeyUp={handleTypingUp} className="border-t border-vx-border bg-vx-panel/60 p-4 outline-none focus-visible:ring-2 focus-visible:ring-vx-accent">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Session MIDI track</p><h2 className="mt-1 font-vx text-xl font-black">Notes through a local wavetable instrument</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-vx-fg-muted">Two harmonic tables morph through a low-pass filter, amplitude envelope and filter LFO. The patch is playable but session-only: no table upload/capture, mod matrix, MIDI Learn, chat design, generated cover or saved project.</p></div><button type="button" onClick={enableExternalMidi} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">Enable external MIDI</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-xs font-bold text-vx-fg-muted">MIDI input<select aria-label="MIDI input" value={midiInputId} onChange={(event) => setMidiInputId(event.target.value)} disabled={!midiInputs.length} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg disabled:opacity-50"><option value="">No external input</option>{midiInputs.map((input) => <option key={input.id} value={input.id}>{input.label}</option>)}</select></label>
        <label className="text-xs font-bold text-vx-fg-muted">Synth preset<select aria-label="Synth preset" value={presetId} onChange={(event) => applyPreset(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg"><option value="custom" disabled>Custom patch</option>{Object.entries(SYNTH_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}</select></label>
        <div className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs"><span className="font-bold">Typing octave</span><strong className="mt-1 block font-vx-mono">{octave >= 0 ? '+' : ''}{octave} · Z/X</strong></div>
        <div className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs"><span className="font-bold">Velocity</span><strong className="mt-1 block font-vx-mono">{velocity} · C/V</strong></div>
      </div>
      <fieldset className="mt-3 rounded-2xl border border-vx-border bg-vx-base p-3"><legend className="px-2 text-xs font-bold uppercase tracking-wider text-vx-fg-muted">Wavetable patch</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-vx-fg-muted">Table A<select aria-label="Wavetable A" value={tableA} onChange={(event) => { setPresetId('custom'); setTableA(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg">{Object.keys(WAVETABLES).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="text-xs font-bold text-vx-fg-muted">Table B<select aria-label="Wavetable B" value={tableB} onChange={(event) => { setPresetId('custom'); setTableB(event.target.value); }} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg">{Object.keys(WAVETABLES).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="text-xs font-bold text-vx-fg-muted">Table morph · {Math.round(morph * 100)}%<input aria-label="Wavetable morph" type="range" min="0" max="1" step="0.01" value={morph} onChange={(event) => { setPresetId('custom'); setMorph(Number(event.target.value)); }} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Filter cutoff · {cutoff} Hz<input aria-label="Synth filter cutoff" type="range" min="120" max="12000" step="20" value={cutoff} onChange={(event) => { setPresetId('custom'); setCutoff(Number(event.target.value)); }} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Resonance · {resonance.toFixed(1)}<input aria-label="Synth resonance" type="range" min="0.1" max="18" step="0.1" value={resonance} onChange={(event) => { setPresetId('custom'); setResonance(Number(event.target.value)); }} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Attack · {attack.toFixed(2)} s<input aria-label="Synth attack" type="range" min="0.005" max="2" step="0.005" value={attack} onChange={(event) => { setPresetId('custom'); setAttack(Number(event.target.value)); }} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Release · {release.toFixed(2)} s<input aria-label="Synth release" type="range" min="0.05" max="3" step="0.05" value={release} onChange={(event) => { setPresetId('custom'); setRelease(Number(event.target.value)); }} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Filter LFO · {lfoRate.toFixed(2)} Hz / {Math.round(lfoDepth * 100)}%<span className="mt-2 grid grid-cols-2 gap-2"><input aria-label="Synth LFO rate" type="range" min="0.05" max="8" step="0.05" value={lfoRate} onChange={(event) => { setPresetId('custom'); setLfoRate(Number(event.target.value)); }} /><input aria-label="Synth LFO depth" type="range" min="0" max="0.5" step="0.01" value={lfoDepth} onChange={(event) => { setPresetId('custom'); setLfoDepth(Number(event.target.value)); }} /></span></label>
      </div></fieldset>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{midiMessage}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-pressed={typing} onClick={() => setTyping((value) => !value)} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">{typing ? 'Musical typing on' : 'Enable musical typing'}</button><button type="button" aria-expanded={keyboardOpen} onClick={() => setKeyboardOpen(true)} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">Open floating synth keyboard</button><button type="button" aria-pressed={capturing} onClick={toggleCapture} className={`min-h-11 rounded-full px-4 text-sm font-bold ${capturing ? 'bg-red-500 text-white' : 'border border-vx-border'}`}>{capturing ? 'Stop MIDI capture' : 'Start MIDI capture'}</button><button type="button" onClick={addNote} disabled={notes.length >= MAX_NOTES} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">Add C4 note</button><button type="button" onClick={quantize} disabled={!notes.length} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">Quantize to 1/16</button><button type="button" onClick={playSequence} disabled={!notes.length} className="min-h-11 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:opacity-40">Play MIDI clip</button></div>
      <p className="mt-3 text-xs text-vx-fg-muted">Focus this panel, then use A–; for white keys and W/E/T/Y/U/O/P for black keys. Z/X shifts octave; C/V changes velocity. Capture begins at the current playhead label.</p>
      {keyboardOpen ? <div role="dialog" aria-labelledby="floating-synth-title" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-3xl border border-vx-accent/50 bg-vx-panel p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h3 id="floating-synth-title" className="font-vx text-lg font-black">Floating wavetable keyboard</h3><p className="mt-1 text-xs text-vx-fg-muted">Mouse/touch notes use the current patch. This panel floats in-page; it cannot move to another display.</p></div><button type="button" onClick={() => setKeyboardOpen(false)} aria-label="Close floating synth keyboard" className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">Close</button></div><div className="mt-3 flex min-w-0 gap-1 overflow-x-auto pb-1" aria-label="Playable synth keys">{KEYBOARD_NOTES.map((pitch) => <button key={pitch} type="button" aria-label={`Play ${noteName(pitch + octave * 12)}`} onPointerDown={() => noteOn(`pointer:${pitch}`, pitch + octave * 12, velocity)} onPointerUp={() => noteOff(`pointer:${pitch}`)} onPointerCancel={() => noteOff(`pointer:${pitch}`)} onPointerLeave={() => noteOff(`pointer:${pitch}`)} className="h-28 min-w-16 rounded-b-xl border border-vx-border bg-white text-sm font-black text-black active:bg-vx-accent">{noteName(pitch + octave * 12)}</button>)}</div></div> : null}
      <div aria-label="MIDI piano roll" className="mt-5 overflow-x-auto rounded-2xl border border-vx-border bg-vx-base p-3">
        <div className="min-w-[44rem]"><div className="grid grid-cols-[3.5rem_7rem_7rem_7rem_7rem_1fr] gap-2 px-2 text-xs font-bold text-vx-fg-muted"><span>Note</span><span>Pitch</span><span>Start beat</span><span>Length</span><span>Velocity</span><span>Actions</span></div>{notes.length ? <ol className="mt-2 space-y-2">{notes.map((note, index) => <li key={note.id} className="grid grid-cols-[3.5rem_7rem_7rem_7rem_7rem_1fr] items-center gap-2 rounded-xl border border-vx-border p-2"><strong>{noteName(note.pitch)}</strong><input aria-label={`Pitch note ${index + 1}`} type="number" min="24" max="108" value={note.pitch} onChange={(event) => updateNote(note.id, 'pitch', event.target.value)} className="min-h-10 rounded-lg bg-vx-panel px-2" /><input aria-label={`Start beat note ${index + 1}`} type="number" min="0" max="128" step="0.125" value={note.start} onChange={(event) => updateNote(note.id, 'start', event.target.value)} className="min-h-10 rounded-lg bg-vx-panel px-2" /><input aria-label={`Length beats note ${index + 1}`} type="number" min="0.125" max="16" step="0.125" value={note.length} onChange={(event) => updateNote(note.id, 'length', event.target.value)} className="min-h-10 rounded-lg bg-vx-panel px-2" /><input aria-label={`Velocity note ${index + 1}`} type="number" min="1" max="127" value={note.velocity} onChange={(event) => updateNote(note.id, 'velocity', event.target.value)} className="min-h-10 rounded-lg bg-vx-panel px-2" /><button type="button" onClick={() => setNotes((current) => current.filter((item) => item.id !== note.id))} className="min-h-10 justify-self-start rounded-full border border-vx-danger/40 px-3 text-xs font-bold text-vx-danger">Delete note</button></li>)}</ol> : <p className="p-5 text-sm text-vx-fg-muted">No MIDI notes yet. Add one, type while capture is armed, or connect a controller.</p>}</div>
      </div>
    </section>
  );
}
