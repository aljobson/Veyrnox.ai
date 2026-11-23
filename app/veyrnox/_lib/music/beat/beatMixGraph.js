import { beatOutput, connectTrackChannel } from './beatOutput.js';
import { buildEffect, parameterWriter } from './beatEffects.js';
import { DEFAULT_MASTER, trackHasMix } from './beatMixRules.mjs';
import { effectiveGain, trackEnabled } from './beatEvents.mjs';
import { automationEnvelope, scheduleAutomation } from './beatAutomation.mjs';
export function stripSignature(track, doc) {
  return JSON.stringify([trackHasMix(track), track.fx?.length ? track.fx.map(f => [f.id, f.type, f.bypass, f.type === 'reverb' && f.params.size]) : undefined,
    ['reverb', 'delay'].map(b => track.sends?.[b] > 0), Object.values(track.automation || {}).some(points => points.length) ? track.automation : undefined,
    !!doc.master, doc.master?.limiter, doc.master?.reverb.size,
    doc.tracks.map(t => ['reverb', 'delay'].map(b => t.sends?.[b] > 0))]);
}
export const mixSignature = doc => doc.tracks.map(t => stripSignature(t, doc)).join('|');
export function buildMaster(context, doc, { destination = context.destination, onError = () => {} } = {}) {
  const nodes = [], write = parameterWriter();
  const setting = doc.master || DEFAULT_MASTER;
  let input, gain, output;
  if (!doc.master) {
    input = beatOutput(context, destination); output = input.outputNode; nodes.push(input, output);
  } else {
    input = context.createGain(); gain = context.createGain(); nodes.push(input, gain);
    input.connect(gain); gain.gain.value = setting.gain; output = gain;
    if (setting.limiter) {
      const options = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 };
      const limiter = context.createDynamicsCompressor(options); nodes.push(limiter);
      Object.entries(options).forEach(([k, v]) => { limiter[k].value = v; });
      gain.connect(limiter); output = limiter;
    }
    output.connect(destination);
  }
  const buses = buildSendBuses(context, doc, input, { onError });
  return { input, output, ...buses, nodes: [...nodes, ...buses.nodes],
    setMaster(master = DEFAULT_MASTER, now) {
      if (gain) write(gain.gain, master.gain, now);
      buses.setMaster(master, now);
    },
    dispose() { nodes.forEach(n => n.disconnect()); buses.dispose(); },
  };
}
// Reused by legacy live runs, whose output is the engine's shared compressor.
export function buildSendBuses(context, doc, input, { onError = () => {} } = {}) {
  const nodes = [], errors = [], sends = {}, buses = new Map();
  function ensureSends(nextDoc) {
    const setting = nextDoc.master || DEFAULT_MASTER;
    for (const bus of ['reverb', 'delay']) if (!buses.has(bus) && nextDoc.tracks.some(t => t.sends?.[bus] > 0)) {
      try {
        const effect = buildEffect(context, { type: bus, params: { ...setting[bus], mix: 1 } });
        effect.output.connect(input); buses.set(bus, effect); sends[bus] = effect.input; nodes.push(...effect.nodes);
      } catch (e) { errors.push(e.message); onError(e.message); }
    }
    return buses.size ? sends : null;
  }
  return { sends: ensureSends(doc), nodes, errors,
    ensureSends(nextDoc) { this.sends = ensureSends(nextDoc); },
    setMaster(master = DEFAULT_MASTER, now) {
      for (const [bus, effect] of buses) effect.update({ ...master[bus], mix: 1 }, now);
    },
    dispose() { nodes.forEach(n => n.disconnect()); },
  };
}
export function buildTrackStrip(context, master, track, { automationActive = false, doc, onError = () => {} } = {}) {
  const mode = automationActive ? 'song' : 'pattern', write = parameterWriter();
  const signature = doc ? stripSignature(track, doc) : '';
  if (!trackHasMix(track)) {
    const channel = connectTrackChannel(context, master.input, doc ? effectiveGain(doc, track.id, mode) : track.gain, track.pan);
    return { ...channel, fader: channel.input, chain: [], sends: {}, meterTap: channel.panner, signature,
      update(t, d, now) { write(channel.input.gain, effectiveGain(d, t.id, mode), now); write(channel.panner.pan, t.pan, now); },
      schedule() {}, dispose() { channel.input.disconnect(); channel.panner.disconnect(); } };
  }
  const input = context.createGain(), fader = context.createGain(), panner = context.createStereoPanner();
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const chain = [], sends = {}, nodes = [input, fader, panner]; let tail = input;
  for (const fx of track.fx || []) if (!fx.bypass) {
    try {
      const effect = buildEffect(context, fx); chain.push({ id: fx.id, type: fx.type, ...effect }); nodes.push(...effect.nodes);
      tail.connect(effect.input); tail = effect.output;
    } catch (e) { master.errors.push(e.message); onError(e.message); }
  }
  tail.connect(fader).connect(panner).connect(master.input);
  for (const bus of ['reverb', 'delay']) if (track.sends?.[bus] > 0 && master.sends?.[bus]) {
    sends[bus] = context.createGain(); nodes.push(sends[bus]); panner.connect(sends[bus]).connect(master.sends[bus]);
  }
  const envelopes = Object.fromEntries(Object.entries(automationActive ? track.automation || {} : {})
    .map(([lane, points]) => [lane, automationEnvelope(points, doc.tempo.bpm)]));
  function update(t, d, now) {
    write(input.gain, trackEnabled(d, t.id, mode) ? 1 : 0, now);
    if (!envelopes.gain) write(fader.gain, t.gain, now);
    if (!envelopes.pan) write(panner.pan, t.pan, now);
    for (const effect of chain) { const fx = t.fx?.find(f => f.id === effect.id); if (fx?.type === effect.type) effect.update(fx.params, now); }
    for (const [bus, node] of Object.entries(sends)) write(node.gain, t.sends?.[bus] || 0, now);
  }
  if (doc) update(track, doc);
  return { input, chain, fader, panner, sends, meterTap: panner, signature, update,
    schedule(window) {
      for (const [lane, envelope] of Object.entries(envelopes)) scheduleAutomation(lane === 'gain' ? fader.gain : panner.pan, envelope, window);
    },
    dispose() { nodes.forEach(n => n.disconnect()); },
  };
}
