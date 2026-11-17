import { hasMixer, mixTailSeconds } from './beatMixRules.mjs';
import { exportSize } from './beatSequence.mjs';
import { AUDIO_RATE, estimateExport, pcmBytes, usedAssets, MB } from './beatAudioRules.mjs';
import { trackContributes, eventsAtStep } from './beatEvents.mjs';
import { midiNoteOnsInWindow } from './beatMidiWindow.mjs';
import { voiceTiming } from './beatVoiceTiming.mjs';
import { stepSeconds, eventTime } from './beatTime.mjs';
export const CHUNKED_EXPORT = false; // Release gate: real browser boundary comparison must pass first.
export const MAX_RECON = 30, SETTLE = 2;
export const PHONE_EXPORT_MESSAGE = 'This song is too long to export on this phone. Export a cycle range, or use a computer.';
export function exportFilename(title, suffix = '') {
  const clean = text => String(text).normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80);
  return `${clean(title) || 'Beat'}${suffix ? ` - ${clean(suffix) || 'Track'}` : ''}.wav`;
}
// Window coordinates are relative to the selected range. Audio is clipped by the
// renderer and never extends reconstruction back to its region's onset.
export function chunkPlan(doc, { range = 'song', chunkSeconds = 60 } = {}) {
  const size = exportSize(doc, AUDIO_RATE, range), step = stepSeconds(doc.tempo.bpm);
  const from = size.startStep * step, end = size.endStep * step, song = { ...doc, view: 'song' };
  const held = [], pools = new Map(), mixTail = hasMixer(doc) ? mixTailSeconds(doc) : 0;
  if (!(chunkSeconds > 0 && chunkSeconds <= 60)) throw new Error('Invalid chunk size.');
  for (const note of midiNoteOnsInWindow(song, from, end, { endSec: end })) {
    const track = doc.tracks.find(t => t.id === note.trackId), timing = voiceTiming(track.instrument, track.instrument.preset);
    const tail = timing.gated ? timing.release + (timing.id === 'wavetable' ? 0.05 : 0.01) : 0.13;
    const life = timing.gated ? note.durationSec + tail : timing.id === 'drums' ? timing.natural : Math.min(timing.natural, note.durationSec + tail);
    if (note.durationSec > MAX_RECON || life > MAX_RECON) return null;
    // Replay pool admission globally, including stealing at the 33rd voice.
    const pool = (pools.get(track.id) || []).filter(v => v.end > note.songTimeSec - from);
    while (pool.length >= 32) pool.shift().end = note.songTimeSec - from + 0.01;
    const voice = { track: track.id, at: note.songTimeSec - from, end: note.songTimeSec - from + life };
    held.push(voice); pool.push(voice); pools.set(track.id, pool);
  }
  for (let i = size.startStep; i < size.endStep; i++) {
    const at = eventTime((i - size.startStep) * step, i, doc.tempo.bpm, doc.swing);
    if (eventsAtStep(song, i).length) held.push({ at, end: at + 1.5 });
  }
  const chunks = [];
  for (let frame = 0; frame < size.frames; frame += Math.round(chunkSeconds * AUDIO_RATE)) {
    const last = Math.min(size.frames, frame + Math.round(chunkSeconds * AUDIO_RATE));
    const a = frame / AUDIO_RATE, b = last / AUDIO_RATE;
    let origin = Math.max(0, a - SETTLE);
    // A released voice may still feed an insert tail at the chunk boundary.
    for (const voice of held) if (voice.at < a && voice.end > a - mixTail) origin = Math.min(origin, voice.at);
    if (mixTail) origin = Math.max(0, origin - mixTail);
    if (a - origin > MAX_RECON + SETTLE) return null;
    origin = Math.floor(origin * AUDIO_RATE) / AUDIO_RATE;
    chunks.push({ startSec: a, endSec: b, originSec: origin, contextFrames: last - Math.round(origin * AUDIO_RATE) });
  }
  return chunks;
}
export function planExport(doc, { range = 'song', output = 'mix', bitDepth = 16, phone = false } = {}) {
  if (!['mix', 'stems'].includes(output) || ![16, 24].includes(bitDepth)) throw new Error('Invalid export options.');
  const size = exportSize(doc, AUDIO_RATE, range);
  const tracks = doc.tracks.map((t, i) => ({ id: t.id, name: t.name || `Track ${i + 1}`,
    audible: trackContributes(doc, t.id, 'song'), filename: exportFilename(doc.title, `${i + 1} ${t.name || 'Track'}`) }));
  const candidates = phone && CHUNKED_EXPORT ? chunkPlan(doc, { range }) : null;
  const chunks = candidates || [{ startSec: 0, endSec: size.frames / AUDIO_RATE, originSec: 0, contextFrames: size.frames }];
  const outputBytes = 44 + size.frames * 2 * bitDepth / 8;
  let retainedAndDecode;
  try { retainedAndDecode = estimateExport(doc, 0) - 44; }
  catch (error) { throw phone ? Object.assign(new Error(PHONE_EXPORT_MESSAGE), { displayCode: 'recovery-r51' }) : error; }
  // Seeded procedural renders coexist with any warm live-cache sound buffers.
  // Reserve both directions conservatively, even when that cache is cold.
  retainedAndDecode += usedAssets(doc).reduce((bytes, id) => bytes + (doc.assets[id].source === 'sound' ? pcmBytes(doc.assets[id])
    * (doc.tracks.some(t => t.regions.some(r => r.assetId === id && r.reverse)) ? 2 : 1) : 0), 0);
  for (const chunk of chunks) if (retainedAndDecode + outputBytes + chunk.contextFrames * 8 > (phone ? 300 : 600) * MB) {
    throw Object.assign(new Error(phone ? PHONE_EXPORT_MESSAGE : 'This song uses too much audio to export. Shorten it or remove some sounds.'), { displayCode: phone ? 'recovery-r51' : 'too-much-audio' });
  }
  return { ...size, range, output, bitDepth, sampleRate: AUDIO_RATE, channels: 2, chunks, tracks,
    filenames: output === 'mix' ? [exportFilename(doc.title)] : tracks.filter(t => t.audible).map(t => t.filename) };
}
export async function assembleExport(planned, renderWindow, writer) {
  let written = 0;
  for (const chunk of planned.chunks) {
    const rendered = await renderWindow(chunk);
    const channels = rendered.channels || rendered;
    const frames = Math.round(chunk.endSec * planned.sampleRate) - Math.round(chunk.startSec * planned.sampleRate);
    if (channels.length !== 2 || channels.some(c => c.length !== frames)) throw new Error('Incomplete rendered audio window.');
    writer.write(channels, written); written += frames;
  }
  if (written !== planned.frames) throw new Error('Incomplete rendered mix.');
  return writer.finish();
}
