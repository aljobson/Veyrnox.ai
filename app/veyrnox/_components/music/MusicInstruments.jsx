'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRUM_PADS, GUITAR_CHORDS, GUITAR_FRETS, GUITAR_STRINGS, INSTRUMENTS, INSTRUMENT_IDS, MAX_TAKE_EVENTS,
  MAX_TAKE_SECONDS, PRESETS, chordNotes, encodeWav, isBlackKey, keyRange, noteLabel, sampleFileName, trimSamples,
} from '../../../../lib/musicInstruments.js';
import { makeNoise, playEvent, renderTake } from '../../_lib/music/instrumentEngine';
import { addShelfTake } from '../../_lib/music/instrumentShelf';
import { deleteSavedTake, listSavedTakes, putSavedTake } from '../../_lib/music/instrumentTakeDb';

const TYPING_KEYS = Object.freeze('awsedftgyhujkolp;'.split(''));
const STRUM_GAP = 0.028;

export function MusicInstruments() {
  const [instrument, setInstrument] = useState('piano');
  const [presetId, setPresetId] = useState('grand');
  const [shift, setShift] = useState(0);
  const [recording, setRecording] = useState(false);
  const [lit, setLit] = useState({});
  const [takes, setTakes] = useState([]);
  const [message, setMessage] = useState('Tap, click or type to play. Press Record to capture a take.');
  const ctxRef = useRef(null);
  const masterRef = useRef(null);
  const noiseRef = useRef(null);
  const recRef = useRef({ on: false, started: 0, events: [], open: new Map() });
  const heldRef = useRef(new Map());
  const stateRef = useRef({ instrument, presetId, shift });

  useEffect(() => { stateRef.current = { instrument, presetId, shift }; }, [instrument, presetId, shift]);
  const pendingRef = useRef(new Map());
  const flushRef = useRef(null);
  useEffect(() => () => { ctxRef.current?.close?.(); window.clearTimeout(flushRef.current); }, []);
  useEffect(() => {
    let live = true;
    listSavedTakes('takes').then((rows) => {
      if (!live || !rows.length) return;
      setTakes((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...rows.filter((row) => !known.has(row.id))].slice(0, 12);
      });
    });
    return () => { live = false; };
  }, []);
  function saveSoon(item) {
    pendingRef.current.set(item.id, item);
    window.clearTimeout(flushRef.current);
    flushRef.current = window.setTimeout(() => {
      pendingRef.current.forEach((row) => putSavedTake('takes', row));
      pendingRef.current.clear();
    }, 600);
  }

  const audio = useCallback(() => {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { setMessage('This browser has no Web Audio support.'); return null; }
    if (!ctxRef.current) {
      const context = new Context();
      const master = context.createGain();
      master.gain.value = 0.8;
      master.connect(context.createDynamicsCompressor()).connect(context.destination);
      ctxRef.current = context; masterRef.current = master; noiseRef.current = makeNoise(context);
    }
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const flash = useCallback((id) => {
    setLit((current) => ({ ...current, [id]: true }));
    window.setTimeout(() => setLit((current) => ({ ...current, [id]: false })), 140);
  }, []);

  const trigger = useCallback((value, id = String(value), vel = 0.85, release) => {
    const context = audio();
    if (!context) return;
    const { instrument: inst, presetId: preset } = stateRef.current;
    const rec = recRef.current;
    const sustained = inst !== 'drums' && inst !== 'guitar';
    playEvent(context, masterRef.current, noiseRef.current, inst, preset, { value, vel, dur: sustained ? 4 : 0.5 }, context.currentTime);
    flash(id);
    if (!rec.on || rec.events.length >= MAX_TAKE_EVENTS) return;
    const at = (performance.now() - rec.started) / 1000;
    if (at > MAX_TAKE_SECONDS) return;
    const event = { at, dur: 0.4, vel, value };
    rec.events.push(event);
    if (release) rec.open.set(id, event);
  }, [audio, flash]);

  const release = useCallback((id) => {
    const rec = recRef.current;
    const event = rec.open.get(id);
    if (event) { event.dur = Math.max(0.1, (performance.now() - rec.started) / 1000 - event.at); rec.open.delete(id); }
  }, []);

  const strum = useCallback((chord, down = true) => {
    const strings = chordNotes(chord);
    (down ? strings : [...strings].reverse()).forEach((item, index) => window.setTimeout(() => trigger(item.note, `s${item.string}`, 0.7), index * STRUM_GAP * 1000));
  }, [trigger]);

  useEffect(() => {
    const down = (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || /input|select|textarea/i.test(event.target?.tagName || '')) return;
      const key = event.key.toLowerCase();
      const { instrument: inst } = stateRef.current;
      if (inst === 'drums') {
        const pad = DRUM_PADS.find((item) => item.key === key);
        if (pad) { event.preventDefault(); trigger(pad.id, pad.id, 0.9); }
      } else if (INSTRUMENTS[inst].surface === 'keys') {
        const slot = TYPING_KEYS.indexOf(key);
        const note = keyRange(inst, stateRef.current.shift)[slot];
        if (slot >= 0 && note != null && !heldRef.current.has(key)) { event.preventDefault(); heldRef.current.set(key, `n${note}`); trigger(note, `n${note}`, 0.85, true); }
      }
    };
    const up = (event) => {
      const key = event.key.toLowerCase();
      const id = heldRef.current.get(key);
      if (!id) return;
      heldRef.current.delete(key);
      release(id);
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [trigger, release]);

  function chooseInstrument(id) {
    setInstrument(id); setPresetId(PRESETS[id][0].id); setShift(0);
  }

  function toggleRecord() {
    const rec = recRef.current;
    if (!rec.on) {
      audio();
      recRef.current = { on: true, started: performance.now(), events: [], open: new Map() };
      setRecording(true); setMessage('Recording. Play, then press Stop.');
      return;
    }
    rec.on = false; setRecording(false);
    const take = { instrument, preset: presetId, events: rec.events };
    if (!rec.events.length) { setMessage('Nothing was played. Try again.'); return; }
    renderTake(take).then(({ samples, sampleRate }) => {
      const seconds = samples.length / sampleRate;
      const item = { id: crypto.randomUUID(), take, samples, sampleRate, seconds, start: 0, end: Math.round(seconds * 100) / 100, createdAt: Date.now(), label: `${INSTRUMENTS[take.instrument].label} · ${PRESETS[take.instrument].find((p) => p.id === take.preset).label}` };
      setTakes((current) => {
        const next = [item, ...current];
        next.slice(12).forEach((old) => deleteSavedTake('takes', old.id));
        return next.slice(0, 12);
      });
      putSavedTake('takes', item);
      setMessage('Take captured and saved in this browser. Trim it and download the sample below.');
    }).catch(() => setMessage('That take could not be rendered.'));
  }

  function playTake(item) {
    const context = audio();
    if (!context) return;
    const clip = trimSamples(item.samples, item.sampleRate, item.start, item.end);
    const buffer = context.createBuffer(1, clip.length, item.sampleRate);
    buffer.copyToChannel(clip, 0);
    const source = context.createBufferSource();
    source.buffer = buffer; source.connect(masterRef.current); source.start();
  }

  function sendToStudio(item) {
    const clip = trimSamples(item.samples, item.sampleRate, item.start, item.end);
    addShelfTake({ label: item.label, samples: clip, sampleRate: item.sampleRate });
    setMessage('Sent to the Studio shelf. Open a song in Studio (Music Library, More Actions) to play it against the track.');
  }

  function download(item) {
    const clip = trimSamples(item.samples, item.sampleRate, item.start, item.end);
    const url = URL.createObjectURL(new Blob([encodeWav(clip, item.sampleRate)], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url; link.download = sampleFileName(item.take); link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const updateTake = (id, patch) => {
    const found = takes.find((item) => item.id === id);
    if (found) saveSoon({ ...found, ...patch });
    setTakes((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const removeTake = (id) => { setTakes((current) => current.filter((t) => t.id !== id)); deleteSavedTake('takes', id); };
  const spec = INSTRUMENTS[instrument];
  const keys = keyRange(instrument, shift);
  const pressProps = (value, id, onRelease) => ({
    onPointerDown: (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); trigger(value, id, 0.85, Boolean(onRelease)); },
    onPointerUp: () => onRelease?.(id),
    onPointerCancel: () => onRelease?.(id),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Instruments</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Play it. Record it. Keep the sample.</h1>
        <p className="mt-3 max-w-2xl leading-7 text-vx-fg-body">Pick an instrument and a sound template, then play on screen with touch, mouse or your keyboard. Everything is made in your browser, so it costs no credits. Download any take as a WAV file to use in your own projects.</p>
      </header>

      <div role="tablist" aria-label="Instrument" className="mt-8 flex gap-2 overflow-x-auto pb-1">
        {INSTRUMENT_IDS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={instrument === id} onClick={() => chooseInstrument(id)} className={`vx-press flex min-h-14 shrink-0 items-center gap-2 rounded-2xl border px-5 font-bold ${instrument === id ? 'border-vx-accent bg-vx-accent/15 text-vx-fg' : 'border-vx-border bg-vx-panel text-vx-fg-body'}`}>
            <span aria-hidden="true" className="text-xl">{INSTRUMENTS[id].glyph}</span>{INSTRUMENTS[id].label}
          </button>
        ))}
      </div>

      <section aria-label="Sound templates" className="mt-4 flex flex-wrap gap-2">
        {PRESETS[instrument].map((preset) => (
          <button key={preset.id} type="button" aria-pressed={presetId === preset.id} onClick={() => setPresetId(preset.id)} className={`min-h-11 rounded-full border px-4 text-left text-sm ${presetId === preset.id ? 'border-vx-accent bg-vx-accent text-vx-accent-ink' : 'border-vx-border bg-vx-panel text-vx-fg-body'}`}>
            <strong>{preset.label}</strong><span className="ml-2 hidden text-xs opacity-80 sm:inline">{preset.hint}</span>
          </button>
        ))}
      </section>

      <section aria-label={`${spec.label} playing surface`} className="mt-5 select-none rounded-2xl border border-vx-border bg-vx-panel p-3 shadow-2xl sm:p-5" style={{ touchAction: 'none' }}>
        {spec.surface === 'keys' ? (
          <>
            <div className="mb-3 flex items-center gap-2 text-sm font-bold">
              <button type="button" onClick={() => setShift((v) => Math.max(-2, v - 1))} className="min-h-11 rounded-full border border-vx-border px-4">Octave −</button>
              <button type="button" onClick={() => setShift((v) => Math.min(2, v + 1))} className="min-h-11 rounded-full border border-vx-border px-4">Octave +</button>
              <span className="text-xs text-vx-fg-muted">Keyboard: A to P plays the first octave.</span>
            </div>
            <div className="flex overflow-x-auto rounded-2xl bg-vx-base p-2" role="group" aria-label="Keys">
              {keys.filter((n) => !isBlackKey(n)).map((note) => {
                const sharp = keys.includes(note + 1) && isBlackKey(note + 1) ? note + 1 : null;
                return (
                  <div key={note} className="relative min-w-[2.6rem] flex-1">
                    <button type="button" aria-label={noteLabel(note)} {...pressProps(note, `n${note}`, release)} className={`h-44 w-full rounded-b-xl border border-vx-border text-xs font-bold text-slate-600 sm:h-56 ${lit[`n${note}`] ? 'bg-vx-accent' : 'bg-white'}`}><span className="mt-32 block sm:mt-44">{noteLabel(note)}</span></button>
                    {sharp ? <button type="button" aria-label={noteLabel(sharp)} {...pressProps(sharp, `n${sharp}`, release)} className={`absolute -right-3 top-0 z-10 h-28 w-6 rounded-b-lg border border-black sm:h-36 sm:w-7 ${lit[`n${sharp}`] ? 'bg-vx-accent' : 'bg-slate-900'}`} /> : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : spec.surface === 'strings' ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Strum a chord">
              {GUITAR_CHORDS.map((chord) => <button key={chord.id} type="button" onClick={() => strum(chord)} className="min-h-11 min-w-14 rounded-full bg-vx-accent px-4 font-bold text-vx-accent-ink">{chord.label}</button>)}
              <span className="text-xs text-vx-fg-muted">Tap a chord to strum, or pluck single notes below.</span>
            </div>
            <div className="space-y-1 rounded-2xl bg-amber-950/60 p-2" role="group" aria-label="Strings and frets">
              {[...GUITAR_STRINGS].map((open, string) => string).reverse().map((string) => (
                <div key={string} className="flex items-center gap-1">
                  {Array.from({ length: GUITAR_FRETS + 1 }, (_, fret) => {
                    const note = GUITAR_STRINGS[string] + fret;
                    return <button key={fret} type="button" aria-label={`String ${string + 1} fret ${fret}`} {...pressProps(note, `s${string}`)} className={`h-11 flex-1 rounded border-b-2 text-xs font-bold ${lit[`s${string}`] ? 'border-vx-accent bg-vx-accent/40' : 'border-slate-400 bg-amber-900/40'}`}>{noteLabel(note)}</button>;
                  })}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Drum pads">
            {DRUM_PADS.map((pad) => (
              <button key={pad.id} type="button" {...pressProps(pad.id, pad.id)} className={`flex h-28 flex-col items-center justify-center rounded-2xl border border-vx-border font-black sm:h-36 ${lit[pad.id] ? 'bg-vx-accent text-vx-accent-ink' : 'bg-vx-base'}`}>
                {pad.label}<span className="mt-1 font-vx-mono text-xs font-normal opacity-70">{pad.key.toUpperCase()}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={toggleRecord} aria-pressed={recording} className={`min-h-12 rounded-full px-6 font-bold ${recording ? 'bg-red-500 text-white' : 'bg-vx-fg text-vx-base'}`}>{recording ? '■ Stop' : '● Record'}</button>
        <p role="status" aria-live="polite" className="text-sm text-vx-fg-muted">{message}</p>
      </div>

      <section aria-label="Takes and samples" className="mt-8">
        <h2 className="font-vx text-2xl font-black">Your takes</h2>
        {takes.length === 0 ? <p className="mt-2 text-sm text-vx-fg-muted">Takes are saved in this browser only. Download a WAV to keep one for good.</p> : (
          <ul className="mt-4 space-y-3">
            {takes.map((item) => (
              <li key={item.id} className="rounded-2xl border border-vx-border bg-vx-panel p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="mr-auto">{item.label}</strong>
                  <span className="font-vx-mono text-xs text-vx-fg-muted">{(item.end - item.start).toFixed(2)}s</span>
                  <button type="button" onClick={() => playTake(item)} className="min-h-11 rounded-full border border-vx-border px-4 font-bold">Play</button>
                  <button type="button" onClick={() => sendToStudio(item)} className="min-h-11 rounded-full border border-vx-border px-4 font-bold">Send to Studio</button>
                  <button type="button" onClick={() => download(item)} className="min-h-11 rounded-full bg-vx-accent px-4 font-bold text-vx-accent-ink">Download WAV</button>
                  <button type="button" onClick={() => removeTake(item.id)} className="min-h-11 rounded-full border border-vx-border px-4 text-vx-fg-muted">Remove</button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-vx-fg-muted">Sample start<input type="range" min="0" max={item.seconds} step="0.01" value={item.start} onChange={(e) => updateTake(item.id, { start: Math.min(Number(e.target.value), item.end - 0.05) })} className="mt-1 w-full" /></label>
                  <label className="text-xs font-bold text-vx-fg-muted">Sample end<input type="range" min="0" max={item.seconds} step="0.01" value={item.end} onChange={(e) => updateTake(item.id, { end: Math.max(Number(e.target.value), item.start + 0.05) })} className="mt-1 w-full" /></label>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm leading-6 text-vx-fg-muted">Want something a keyboard cannot make? <Link href="/app/music/create" className="font-bold text-vx-accent">Generate a full track with AI</Link> or <Link href="/app/music/sounds" className="font-bold text-vx-accent">create a sound or loop</Link>.</p>
      </section>
    </div>
  );
}
