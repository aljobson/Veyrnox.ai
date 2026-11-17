import { drainCapture } from './beatCapture.js';
import { splitPasses } from './beatTakeCapture.mjs';
import { tickSeconds } from './beatAudioSegments.mjs';
import { putBeatTake, discardBeatTakes } from './beatTakeStore.js';
import { commitRecording, recordingCapacity } from './beatTakeOps.mjs';
export const takeAsset = row => ({ source: 'take', ref: row.id, name: row.label.slice(0, 80), durationSec: row.samples.length / row.sampleRate, bpm: null, sourceChannels: 1, encodedBytes: 0 });
// Cloud takes are mono 16-bit WAV, including the 44-byte header.
export const maxLaneSeconds = sampleRate => Math.min(600, Math.floor((60_000_000 - 44) / (2 * sampleRate)));
export function recordingDurationLimit(range, bpm, sampleRate, maxPasses) {
  const laneSeconds = maxLaneSeconds(sampleRate), passSeconds = tickSeconds(range.length, bpm);
  const cloudSeconds = !range.cycle || passSeconds > laneSeconds ? laneSeconds : Infinity;
  const passLimit = range.cycle ? maxPasses * passSeconds : passSeconds;
  const seconds = Math.min(600, range.maxSeconds ?? 600, cloudSeconds, passLimit);
  return { seconds, cloud: seconds === cloudSeconds && laneSeconds < 600, passes: range.cycle && seconds === passLimit };
}
export function audioRecordingRange(doc, locator) {
  const cycle = doc.cycle.on && locator >= doc.cycle.start && locator < doc.cycle.end;
  const start = cycle ? doc.cycle.start : Math.floor(locator / 240) * 240;
  const end = cycle ? doc.cycle.end : Math.floor(Math.min(512 * 3840, 600 * doc.tempo.bpm * 16) / 240) * 240;
  if (cycle && doc.cycle.end - doc.cycle.start < 3840) throw new Error('Cycle recording needs a cycle of at least 1 bar');
  return { start, length: end - start, cycle };
}
export function createAudioRecording({ doc, trackId, range, capture, rtt, contextStart, countIn, current, edit, announce, onState, stop, persist = putBeatTake, drain = drainCapture }) {
  const sr = capture.context.sampleRate, bpm = doc.tempo.bpm, recordingId = crypto.randomUUID();
  const startSec = tickSeconds(range.start, bpm), endSec = tickSeconds(range.start + range.length, bpm);
  const c0 = contextStart + (countIn ? tickSeconds(3840, bpm) : 0);
  const capacity = recordingCapacity(doc, trackId, { start: range.start, length: range.cycle ? range.length : 240 });
  if (!capacity.lanes) throw new Error(capacity.reason);
  const previousLanes = doc.tracks.find(t => t.id === trackId).takeGroups?.find(g => g.id === capacity.appendTo)?.lanes.length || 0;
  const maxPasses = capacity.lanes, limit = recordingDurationLimit(range, bpm, sr, maxPasses), maxSeconds = limit.seconds;
  const firstFrame = Math.round((c0 + rtt) * sr), lastFrame = firstFrame + Math.floor(maxSeconds * sr);
  const chunks = [], windows = [], ids = new Map(), savedPasses = new Set();
  let frames = 0, finishPromise, stopped = false, finishEnd, unsubscribe, writing = Promise.resolve(), lastCheckpoint = c0, readyRows = null, failure = '', committed = false, stopReason = '', lastPassCheckpoint = 0;
  const split = end => splitPasses(chunks, windows, { sr, rtt, groupStartSec: startSec, groupEndSec: endSec, cycle: range.cycle, endContextTime: end, maxPasses });
  function rowFor(part, length) {
    if (!ids.has(part.pass)) ids.set(part.pass, crypto.randomUUID());
    const name = doc.tracks.find(t => t.id === trackId).name;
    return { id: ids.get(part.pass), label: `Take ${previousLanes + part.pass + 1} · ${name}`.slice(0, 80), samples: part.samples, sampleRate: sr, createdAt: Date.now(), beatId: doc.id, state: 'pending',
      pending: { beatId: doc.id, trackId, start: range.start, length, pass: part.pass, recordingId } };
  }
  function checkpoint(end) {
    const parts = split(end).filter(p => range.cycle ? p.complete && !savedPasses.has(p.pass) : p.samples.length >= sr);
    for (const part of parts) {
      savedPasses.add(part.pass);
      const length = range.cycle ? range.length : Math.floor(part.samples.length / sr / tickSeconds(240, bpm)) * 240;
      const row = rowFor(part, length);
      writing = writing.catch(() => {}).then(() => persist(row)).catch(e => { failure = e.message; announce(e.message); stop(); });
    }
  }
  unsubscribe = capture.subscribe(chunk => {
    const maxFrames = Math.floor(maxSeconds * sr);
    // Discard count-in before budgeting memory; crop the last block before it
    // can reach a checkpoint or become an oversized cloud take.
    const from = Math.max(chunk.frame, firstFrame), to = Math.min(chunk.frame + chunk.samples.length, lastFrame);
    if (to > from && frames < maxFrames) {
      const samples = chunk.samples.slice(from - chunk.frame, Math.min(to - chunk.frame, from - chunk.frame + maxFrames - frames));
      chunks.push({ frame: from, samples }); frames += samples.length;
    }
    if (stopped) return;
    const time = (chunk.frame + chunk.samples.length) / sr - rtt;
    const elapsed = Math.max(0, time - c0), pass = range.cycle ? Math.floor(elapsed / (endSec - startSec)) : 0;
    onState({ status: 'recording', seconds: elapsed, pass: previousLanes + Math.min(maxPasses, pass + 1) });
    if (range.cycle ? pass > lastPassCheckpoint : time - lastCheckpoint >= 10) { checkpoint(Math.min(time, c0 + maxSeconds)); lastCheckpoint = time; lastPassCheckpoint = pass; }
    if (frames >= maxFrames || elapsed >= maxSeconds || (range.cycle && pass >= maxPasses)) {
      finishEnd = Math.min(c0 + maxSeconds, range.cycle ? c0 + maxPasses * (endSec - startSec) : Infinity);
      stopReason = limit.cloud ? 'Take size limit reached — recording stopped before the 60 MB upload limit.'
        : limit.passes && previousLanes + maxPasses === 8 ? 'Take limit reached — 8 takes per section.' : 'Recording limit reached — takes kept.';
      announce(stopReason); stop();
    }
  });
  async function commit() {
    if (committed) return current();
    if (!readyRows?.length) return current();
    for (const row of readyRows) await persist(row);
    const length = range.cycle ? range.length : readyRows[0].pending.length;
    const latest = current();
    if (latest.id !== doc.id) throw new Error('Open the original beat to recover these takes.');
    const next = commitRecording(latest, { trackId, start: range.start, length, takes: readyRows.map(row => ({ asset: takeAsset(row) })) });
    const count = next.tracks.find(t => t.id === trackId).takeGroups.find(g => g.start === range.start && g.length === length).lanes.length;
    if (!edit(() => next, { recordingCommit: true, label: `Recorded ${readyRows.length} takes`, message: `Recorded ${readyRows.length} takes — using take ${count}` })) throw new Error('Could not commit the recorded takes. Try again.');
    committed = true; failure = ''; return next;
  }
  return {
    get error() { return failure; }, get finishing() { return !!finishPromise; },
    window(window) { if (!stopped) windows.push(window); },
    finish() {
      if (finishPromise) return finishPromise;
      stopped = true;
      const end = Math.min(finishEnd ?? capture.context.currentTime, c0 + maxSeconds);
      onState({ status: 'finishing' });
      finishPromise = (async () => {
        let early = false;
        try {
          early = !await drain(capture, end, rtt);
          unsubscribe(); await writing;
          const parts = split(end), kept = parts.filter(p => !range.cycle || p.complete || p.samples.length >= sr);
          if (kept.length < parts.length) announce('Final pass shorter than 1 second discarded.');
          readyRows = kept.map(p => rowFor(p, range.cycle ? range.length : Math.floor(p.samples.length / sr / tickSeconds(240, bpm)) * 240)).filter(r => r.pending.length >= 240);
          chunks.length = 0; windows.length = 0;
          await discardBeatTakes([...ids.values()].filter(id => !readyRows.some(r => r.id === id)));
          const result = await commit();
          if (stopReason) announce(stopReason);
          if (early) announce(`Recording stopped early — takes kept up to bar ${Math.floor((range.start + (readyRows.at(-1)?.pending.length || 0)) / 3840) + 1}.`);
          return result;
        } catch (e) { failure = e.message; announce(e.message); return current(); }
        finally { unsubscribe(); onState({ status: failure ? 'error' : 'armed', error: failure }); }
      })();
      return finishPromise;
    },
    async retry() { try { const result = await commit(); onState({ status: 'armed', error: '' }); return result; } catch (e) { failure = e.message; onState({ status: 'error', error: failure }); return current(); } },
  };
}
