'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const INITIAL_EFFECTS = Object.freeze([
  { id: 'eq-1', type: 'eq', name: 'EQ', detail: 'Peaking filter', parameters: { gain: 0 } },
  { id: 'compressor-1', type: 'compressor', name: 'Compressor', detail: 'Dynamics control', parameters: { threshold: -24, ratio: 4 } },
  { id: 'distortion-1', type: 'distortion', name: 'Distortion', detail: 'Waveshaping drive', parameters: { drive: 0 } },
  { id: 'delay-1', type: 'delay', name: 'Delay', detail: 'Time-based echo', parameters: { time: 0.22, mix: 0.15 } },
  { id: 'reverb-1', type: 'reverb', name: 'Convolution reverb', detail: 'Generated room impulse', parameters: { mix: 0.12 } },
]);
const MAX_AUTOMATION_POINTS = 16;
const MAX_EFFECTS = 10;

function bounded(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function distortionCurve(amount) {
  const drive = bounded(amount, 0, 100, 0);
  const curve = new Float32Array(1024);
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index * 2) / (curve.length - 1) - 1;
    curve[index] = drive ? ((3 + drive) * input * 20 * (Math.PI / 180)) / (Math.PI + drive * Math.abs(input)) : input;
  }
  return curve;
}

function roomImpulse(context, seconds) {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * ((1 - index / length) ** 2.5);
    }
  }
  return impulse;
}

function interpolate(points, time) {
  if (!points.length) return 1;
  const ordered = [...points].sort((left, right) => left.time - right.time);
  if (time <= ordered[0].time) return ordered[0].value;
  if (time >= ordered.at(-1).time) return ordered.at(-1).value;
  const afterIndex = ordered.findIndex((point) => point.time >= time);
  const before = ordered[afterIndex - 1]; const after = ordered[afterIndex];
  const span = after.time - before.time;
  return span > 0 ? before.value + ((time - before.time) / span) * (after.value - before.value) : after.value;
}

function connectParallel(context, processor, initialMix) {
  const input = context.createGain(); const output = context.createGain();
  const dry = context.createGain(); const wet = context.createGain();
  dry.gain.value = 1 - initialMix; wet.gain.value = initialMix;
  input.connect(dry).connect(output); input.connect(processor).connect(wet).connect(output);
  return { input, output, processor, dry, wet };
}

function buildDevice(context, effect) {
  if (effect.type === 'eq') {
    const node = context.createBiquadFilter(); node.type = 'peaking'; node.frequency.value = 1200; node.Q.value = 0.9; node.gain.value = effect.parameters.gain;
    return { input: node, output: node, node, nodes: [node] };
  }
  if (effect.type === 'compressor') {
    const node = context.createDynamicsCompressor(); node.threshold.value = effect.parameters.threshold; node.ratio.value = effect.parameters.ratio;
    return { input: node, output: node, node, nodes: [node] };
  }
  if (effect.type === 'distortion') {
    const node = context.createWaveShaper(); node.curve = distortionCurve(effect.parameters.drive); node.oversample = '2x';
    return { input: node, output: node, node, nodes: [node] };
  }
  if (effect.type === 'delay') {
    const node = context.createDelay(1); node.delayTime.value = effect.parameters.time;
    const device = connectParallel(context, node, effect.parameters.mix); const feedback = context.createGain(); feedback.gain.value = 0.28;
    node.connect(feedback).connect(node); return { ...device, feedback, nodes: [device.input, device.output, device.dry, device.wet, node, feedback] };
  }
  const node = context.createConvolver(); node.buffer = roomImpulse(context, 1.25);
  const device = connectParallel(context, node, effect.parameters.mix);
  return { ...device, nodes: [device.input, device.output, device.dry, device.wet, node] };
}

function buildRack(context, effects) {
  return new Map(effects.map((effect) => [effect.id, buildDevice(context, effect)]));
}

function disposeRack(rack) {
  rack.forEach((device) => device.nodes.forEach((node) => { try { node.disconnect(); } catch {} }));
}

function applyParameters(effect, device) {
  if (effect.type === 'eq') device.node.gain.value = effect.parameters.gain;
  if (effect.type === 'compressor') { device.node.threshold.value = effect.parameters.threshold; device.node.ratio.value = effect.parameters.ratio; }
  if (effect.type === 'distortion') device.node.curve = distortionCurve(effect.parameters.drive);
  if (effect.type === 'delay') { device.processor.delayTime.value = effect.parameters.time; device.dry.gain.value = 1 - effect.parameters.mix; device.wet.gain.value = effect.parameters.mix; }
  if (effect.type === 'reverb') { device.dry.gain.value = 1 - effect.parameters.mix; device.wet.gain.value = effect.parameters.mix; }
}

export function MusicStudioEffects({ sourceAudioRef, playheadSeconds, duration, manualVolume, muted, onActiveChange }) {
  const [active, setActive] = useState(false); const [message, setMessage] = useState('Audio stays on its original path until you choose Enable audio effects.');
  const [effects, setEffects] = useState(() => INITIAL_EFFECTS.map((effect) => ({ ...effect, bypassed: false, expanded: false })));
  const [copiedEffect, setCopiedEffect] = useState(null);
  const [automationOpen, setAutomationOpen] = useState(false); const [automationValue, setAutomationValue] = useState(1); const [points, setPoints] = useState([]);
  const contextRef = useRef(null); const sourceRef = useRef(null); const masterRef = useRef(null); const rackRef = useRef(new Map());
  const effectiveAutomation = useMemo(() => interpolate(points, Number(playheadSeconds) || 0), [playheadSeconds, points]);

  const reconnect = useCallback((nextEffects = effects) => {
    const source = sourceRef.current; const master = masterRef.current;
    if (!source || !master) return;
    try {
      source.disconnect();
      rackRef.current.forEach((device) => device.output.disconnect());
      let tail = source;
      nextEffects.filter((effect) => !effect.bypassed).forEach((effect) => {
        const device = rackRef.current.get(effect.id); if (!device) return;
        tail.connect(device.input); tail = device.output;
      });
      tail.connect(master);
    } catch {}
  }, [effects]);

  async function activate() {
    if (active) return;
    const audio = sourceAudioRef.current; const Context = window.AudioContext || window.webkitAudioContext;
    if (!audio || !Context || typeof Context.prototype.createMediaElementSource !== 'function') {
      setMessage('Real-time media effects are unavailable in this browser. The original audio path is unchanged.'); return;
    }
    try {
      const context = new Context(); const source = context.createMediaElementSource(audio); const master = context.createGain();
      const rack = buildRack(context, effects);
      contextRef.current = context; sourceRef.current = source; masterRef.current = master; rackRef.current = rack;
      master.connect(context.destination); await context.resume?.();
      setActive(true); onActiveChange(true); setMessage('Five local effects are live on Audio 1. Adjustments are audible immediately.');
    } catch {
      setMessage('The browser could not attach a real-time effects graph. The original audio path is unchanged.');
    }
  }

  useEffect(() => {
    const context = contextRef.current; if (!active || !context) return;
    const currentIds = [...rackRef.current.keys()]; const nextIds = effects.map((effect) => effect.id);
    if (currentIds.length !== nextIds.length || currentIds.some((id) => !nextIds.includes(id))) {
      disposeRack(rackRef.current); rackRef.current = buildRack(context, effects);
    } else effects.forEach((effect) => applyParameters(effect, rackRef.current.get(effect.id)));
    reconnect(effects);
  }, [active, effects, reconnect]);
  useEffect(() => {
    const context = contextRef.current; const master = masterRef.current; if (!active || !context || !master) return;
    const target = muted ? 0 : manualVolume * effectiveAutomation;
    master.gain.cancelScheduledValues?.(context.currentTime); master.gain.setTargetAtTime?.(target, context.currentTime, 0.015);
    if (!master.gain.setTargetAtTime) master.gain.value = target;
  }, [active, effectiveAutomation, manualVolume, muted]);
  useEffect(() => () => {
    try { sourceRef.current?.disconnect(); masterRef.current?.disconnect(); disposeRack(rackRef.current); contextRef.current?.close?.(); } catch {}
  }, []);

  function updateEffect(id, patch) {
    setEffects((current) => current.map((effect) => effect.id === id ? { ...effect, ...patch } : effect));
  }

  function updateParameter(id, name, value) {
    setEffects((current) => current.map((effect) => effect.id === id ? { ...effect, parameters: { ...effect.parameters, [name]: value } } : effect));
  }

  function cloneEffect(effect, suffix = 'copy') {
    return { ...effect, id: `${effect.type}-${crypto.randomUUID()}`, name: `${effect.name.replace(/ copy \d+$/, '')} ${suffix}`, parameters: { ...effect.parameters }, bypassed: false, expanded: true };
  }

  function duplicateEffect(effect) {
    setEffects((current) => {
      if (current.length >= MAX_EFFECTS) return current;
      const index = current.findIndex((item) => item.id === effect.id); const next = [...current];
      next.splice(index + 1, 0, cloneEffect(effect, `copy ${current.filter((item) => item.type === effect.type).length}`)); return next;
    });
  }

  function copyEffect(effect) {
    setCopiedEffect({ ...effect, parameters: { ...effect.parameters } }); setMessage(`${effect.name} settings copied locally.`);
  }

  function pasteEffect() {
    if (!copiedEffect || effects.length >= MAX_EFFECTS) return;
    setEffects((current) => [...current, cloneEffect(copiedEffect, `copy ${current.filter((item) => item.type === copiedEffect.type).length}`)]);
  }

  function moveEffect(id, direction) {
    setEffects((current) => {
      const index = current.findIndex((effect) => effect.id === id); const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current]; [next[index], next[destination]] = [next[destination], next[index]]; return next;
    });
  }

  function addAutomationPoint() {
    if (points.length >= MAX_AUTOMATION_POINTS) return;
    const time = bounded(playheadSeconds, 0, Math.max(0, Number(duration) || 600), 0);
    setPoints((current) => [...current, { id: crypto.randomUUID(), time, value: automationValue }].sort((left, right) => left.time - right.time));
  }

  function updatePoint(id, field, value) {
    setPoints((current) => current.map((point) => point.id === id ? { ...point, [field]: field === 'time' ? bounded(value, 0, Math.max(0, Number(duration) || 600), point.time) : bounded(value, 0, 1.25, point.value) } : point).sort((left, right) => left.time - right.time));
  }

  return (
    <section aria-label="Studio effects and automation" className="border-t border-vx-border bg-vx-base/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Audio 1 processing</p><h2 className="mt-1 font-vx text-xl font-black">Real-time effects chain</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-vx-fg-muted">Ordered Web Audio devices process the real song clip after one explicit activation. This local rack is not saved or included in downloads.</p></div><button type="button" onClick={activate} disabled={active} className="min-h-11 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:opacity-60">{active ? 'Audio effects enabled' : 'Enable audio effects'}</button></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-vx-fg-muted">{message}</p><button type="button" onClick={pasteEffect} disabled={!copiedEffect || effects.length >= MAX_EFFECTS} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold disabled:opacity-40">Paste copied effect</button></div>
      <ol aria-label="Ordered effects chain" className="mt-4 space-y-2">
        {effects.map((effect, index) => <li key={effect.id} className="rounded-2xl border border-vx-border bg-vx-panel p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-vx-base font-vx-mono text-xs">{index + 1}</span><button type="button" aria-label={`Edit ${effect.name}`} aria-expanded={effect.expanded} onClick={() => updateEffect(effect.id, { expanded: !effect.expanded })} className="min-h-10 flex-1 text-left"><strong>{effect.name}</strong><span className="ml-2 text-xs text-vx-fg-muted">{effect.detail}</span></button><button type="button" onClick={() => moveEffect(effect.id, -1)} disabled={index === 0} aria-label={`Move ${effect.name} earlier`} className="min-h-10 rounded-full border border-vx-border px-3 disabled:opacity-30">↑</button><button type="button" onClick={() => moveEffect(effect.id, 1)} disabled={index === effects.length - 1} aria-label={`Move ${effect.name} later`} className="min-h-10 rounded-full border border-vx-border px-3 disabled:opacity-30">↓</button><button type="button" aria-label={`Copy ${effect.name}`} onClick={() => copyEffect(effect)} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold">Copy</button><button type="button" aria-label={`Duplicate ${effect.name}`} onClick={() => duplicateEffect(effect)} disabled={effects.length >= MAX_EFFECTS} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold disabled:opacity-30">Duplicate</button><button type="button" aria-pressed={effect.bypassed} onClick={() => updateEffect(effect.id, { bypassed: !effect.bypassed })} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold">{effect.bypassed ? 'Bypassed' : 'Bypass'}</button><button type="button" aria-label={`Remove ${effect.name}`} onClick={() => setEffects((current) => current.filter((item) => item.id !== effect.id))} disabled={effects.length === 1} className="min-h-10 rounded-full border border-vx-danger/40 px-3 text-xs font-bold text-vx-danger disabled:opacity-30">Remove</button></div>
          {effect.expanded && <div className="mt-3 border-t border-vx-border pt-3">
            {effect.type === 'eq' && <label className="text-xs font-bold">Mid EQ · {effect.parameters.gain > 0 ? '+' : ''}{effect.parameters.gain} dB<input aria-label={`${effect.name} gain`} type="range" min="-12" max="12" step="1" value={effect.parameters.gain} onChange={(event) => updateParameter(effect.id, 'gain', Number(event.target.value))} className="mt-2 w-full" /></label>}
            {effect.type === 'compressor' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Threshold · {effect.parameters.threshold} dB<input aria-label={`${effect.name} threshold`} type="range" min="-60" max="0" step="1" value={effect.parameters.threshold} onChange={(event) => updateParameter(effect.id, 'threshold', Number(event.target.value))} className="mt-2 w-full" /></label><label className="text-xs font-bold">Ratio · {effect.parameters.ratio}:1<input aria-label={`${effect.name} ratio`} type="range" min="1" max="20" step="1" value={effect.parameters.ratio} onChange={(event) => updateParameter(effect.id, 'ratio', Number(event.target.value))} className="mt-2 w-full" /></label></div>}
            {effect.type === 'distortion' && <label className="text-xs font-bold">Drive · {effect.parameters.drive}%<input aria-label={`${effect.name} drive`} type="range" min="0" max="100" step="1" value={effect.parameters.drive} onChange={(event) => updateParameter(effect.id, 'drive', Number(event.target.value))} className="mt-2 w-full" /></label>}
            {effect.type === 'delay' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Time · {effect.parameters.time.toFixed(2)} s<input aria-label={`${effect.name} time`} type="range" min="0" max="1" step="0.01" value={effect.parameters.time} onChange={(event) => updateParameter(effect.id, 'time', Number(event.target.value))} className="mt-2 w-full" /></label><label className="text-xs font-bold">Mix · {Math.round(effect.parameters.mix * 100)}%<input aria-label={`${effect.name} mix`} type="range" min="0" max="0.8" step="0.01" value={effect.parameters.mix} onChange={(event) => updateParameter(effect.id, 'mix', Number(event.target.value))} className="mt-2 w-full" /></label></div>}
            {effect.type === 'reverb' && <label className="text-xs font-bold">Room mix · {Math.round(effect.parameters.mix * 100)}%<input aria-label={`${effect.name} mix`} type="range" min="0" max="0.8" step="0.01" value={effect.parameters.mix} onChange={(event) => updateParameter(effect.id, 'mix', Number(event.target.value))} className="mt-2 w-full" /></label>}
          </div>}
        </li>)}
      </ol>
      <div className="mt-5 rounded-2xl border border-vx-border bg-vx-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">Track volume automation</h3><p className="mt-1 text-xs text-vx-fg-muted">Linear point interpolation · live effective value {effectiveAutomation.toFixed(2)}</p></div><button type="button" aria-expanded={automationOpen} onClick={() => setAutomationOpen((value) => !value)} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold">{automationOpen ? 'Hide automation' : 'Automation'}</button></div>
        {automationOpen && <div className="mt-4 border-t border-vx-border pt-4"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-bold">Point value · {automationValue.toFixed(2)}<input aria-label="New automation point value" type="range" min="0" max="1.25" step="0.05" value={automationValue} onChange={(event) => setAutomationValue(Number(event.target.value))} className="mt-2 block w-48" /></label><button type="button" onClick={addAutomationPoint} disabled={points.length >= MAX_AUTOMATION_POINTS} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">Add point at playhead</button><button type="button" onClick={() => setPoints([])} disabled={!points.length} className="min-h-11 rounded-full border border-vx-danger/40 px-4 text-sm font-bold text-vx-danger disabled:opacity-40">Clear lane</button></div>
          <div role="img" aria-label="Volume automation lane" className="relative mt-4 h-28 overflow-hidden rounded-xl border border-vx-border bg-[linear-gradient(0deg,transparent_24%,rgba(255,255,255,.06)_25%,transparent_26%,transparent_49%,rgba(255,255,255,.06)_50%,transparent_51%,transparent_74%,rgba(255,255,255,.06)_75%,transparent_76%)]">{points.map((point) => <span key={point.id} aria-hidden="true" className="absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white bg-vx-accent" style={{ left: `${duration ? Math.min(100, (point.time / duration) * 100) : 0}%`, bottom: `${Math.min(100, (point.value / 1.25) * 100)}%` }} />)}<span aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${duration ? Math.min(100, (playheadSeconds / duration) * 100) : 0}%` }} /></div>
          {points.length ? <ol className="mt-3 space-y-2">{points.map((point, index) => <li key={point.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><label className="text-xs font-bold">Time point {index + 1}<input aria-label={`Automation time point ${index + 1}`} type="number" min="0" max={Math.max(0, Number(duration) || 600)} step="0.01" value={point.time} onChange={(event) => updatePoint(point.id, 'time', event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-vx-border bg-vx-base px-2" /></label><label className="text-xs font-bold">Value point {index + 1}<input aria-label={`Automation value point ${index + 1}`} type="number" min="0" max="1.25" step="0.05" value={point.value} onChange={(event) => updatePoint(point.id, 'value', event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-vx-border bg-vx-base px-2" /></label><button type="button" onClick={() => setPoints((current) => current.filter((item) => item.id !== point.id))} className="min-h-10 rounded-full border border-vx-danger/40 px-3 text-xs font-bold text-vx-danger">Delete</button></li>)}</ol> : <p className="mt-3 text-xs text-vx-fg-muted">No points. Add one at the current playhead to make the live master gain follow this lane.</p>}
        </div>}
      </div>
      <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Bounded local subset: five effect types, up to ten independent instances, copy/paste, duplicate, remove, reorder, bypass and straight-line volume automation. No cross-track move, gate, sidechain, presets, parameter curves, custom chat plugins, saved project state, offline render or effect-bearing export.</p>
    </section>
  );
}
