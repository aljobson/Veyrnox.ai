import { assertBeatWritable, beatReadOnly, BEAT_READ_ONLY_MESSAGE, capabilityGeneration, assertBeatGeneration, subscribeBeatWrites } from './beatCompatibility.mjs';
import { beatEnglish } from './beatDisplay.mjs';
import { drainCapture } from './beatCapture.js';
import { splitPasses } from './beatTakeCapture.mjs';
import { tickSeconds } from './beatAudioSegments.mjs';
import { putBeatTake, appendBeatTake, discardBeatTakes } from './beatTakeStore.js';
import { commitRecording, recordingCapacity } from './beatTakeOps.mjs';
export const takeAsset = row => ({ source: 'take', ref: row.id, name: row.label.slice(0, 80), durationSec: (row.samples?.length ?? row.length) / row.sampleRate, bpm: null, sourceChannels: 1, encodedBytes: 0 });
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
export function createAudioRecording({ doc, trackId, range, capture, rtt, contextStart, countIn, current, edit, announce, onState, stop, persist = putBeatTake, checkpointPersist = appendBeatTake, discard = discardBeatTakes, onSettled = () => {}, drain = drainCapture, t = beatEnglish }) {
  assertBeatWritable(doc);
  const generation = capabilityGeneration();
  const writable = () => { if (current().version === 5) assertBeatGeneration(generation); assertBeatWritable(current()); };
  let revoked = false;
  const revoke = () => { if (beatReadOnly(current())) { revoked = true; announce(t(BEAT_READ_ONLY_MESSAGE)); void stop(); } };
  const sr = capture.context.sampleRate, bpm = doc.tempo.bpm, recordingId = crypto.randomUUID();
  const startSec = tickSeconds(range.start, bpm), endSec = tickSeconds(range.start + range.length, bpm);
  const c0 = contextStart + (countIn ? tickSeconds(3840, bpm) : 0);
  const capacity = recordingCapacity(doc, trackId, { start: range.start, length: range.cycle ? range.length : 240, single: !range.cycle, preflight: !range.cycle });
  if (!capacity.lanes) throw new Error(capacity.reason);
  const unsubscribeWrites = subscribeBeatWrites(revoke);
  const previousLanes = doc.tracks.find(t => t.id === trackId).takeGroups?.find(g => g.id === capacity.appendTo)?.lanes.length || 0;
  const maxPasses = capacity.lanes, limit = recordingDurationLimit(range, bpm, sr, maxPasses), maxSeconds = limit.seconds;
  const firstFrame = Math.round((c0 + rtt) * sr), lastFrame = firstFrame + Math.floor(maxSeconds * sr);
  const chunks = [], windows = [], ids = new Map();
  let frames = 0, finishPromise, stopped = false, finishEnd, unsubscribe, writing = Promise.resolve(), lastCheckpoint = c0, readyRows = null, failure = '', committed = false, stopReason = '', lastPassCheckpoint = 0, checkpointIndex = 0, checkpointFrame = firstFrame;
  const split = end => splitPasses(chunks, windows, { sr, rtt, groupStartSec: startSec, groupEndSec: endSec, cycle: range.cycle, endContextTime: end, maxPasses });
  function rowFor(part, length) {
    if (!ids.has(part.pass)) ids.set(part.pass, crypto.randomUUID());
    const name = doc.tracks.find(t => t.id === trackId).name;
    return { id: ids.get(part.pass), label: `Take ${previousLanes + part.pass + 1} · ${name}`.slice(0, 80), samples: part.samples, sampleRate: sr, createdAt: Date.now(), beatId: doc.id, state: 'pending',
      pending: { beatId: doc.id, trackId, start: range.start, length, pass: part.pass, recordingId, cycle: !!range.cycle } };
  }
  function failed(error) {
    failure = error.message; onState({ error: failure }); announce(failure); void stop();
  }
  function checkpoint(end) {
    const until = range.cycle ? c0 + Math.floor((end - c0) / (endSec - startSec)) * (endSec - startSec) : end;
    const fresh = chunks.slice(checkpointIndex).map(chunk => {
      const from = Math.max(chunk.frame, checkpointFrame);
      return { frame: from, samples: chunk.samples.subarray(from - chunk.frame) };
    });
    const parts = splitPasses(fresh, windows, { sr, rtt, groupStartSec: startSec, groupEndSec: endSec, cycle: range.cycle, endContextTime: until, maxPasses, compact: true });
    for (const part of parts) {
      const length = range.cycle ? range.length : Math.floor((part.offset + part.samples.length) / sr / tickSeconds(240, bpm)) * 240;
      const row = rowFor(part, length);
      writing = writing.then(() => { if (!failure && !revoked) { writable(); return checkpointPersist(row, part.offset, writable); } }).catch(failed);
    }
    checkpointFrame = Math.round((until + rtt) * sr);
    while (checkpointIndex < chunks.length && chunks[checkpointIndex].frame + chunks[checkpointIndex].samples.length <= checkpointFrame) checkpointIndex++;
  }
  unsubscribe = capture.subscribe(chunk => {
    try {
      const maxFrames = Math.floor(maxSeconds * sr);
      // Discard count-in before budgeting memory; crop the last block before it
      // can reach a checkpoint or become an oversized cloud take.
      const from = Math.max(chunk.frame, firstFrame), to = Math.min(chunk.frame + chunk.samples.length, lastFrame);
      if (to > from && frames < maxFrames) {
        const samples = chunk.samples.slice(from - chunk.frame, Math.min(to - chunk.frame, from - chunk.frame + maxFrames - frames));
        chunks.push({ frame: from, samples }); frames += samples.length;
      }
      if (stopped || revoked) return;
      const time = (chunk.frame + chunk.samples.length) / sr - rtt;
      const elapsed = Math.max(0, time - c0), pass = range.cycle ? Math.floor(elapsed / (endSec - startSec)) : 0;
      onState({ status: 'recording', seconds: elapsed, pass: previousLanes + Math.min(maxPasses, pass + 1) });
      if (range.cycle ? pass > lastPassCheckpoint : time - lastCheckpoint >= 10) { checkpoint(Math.min(time, c0 + maxSeconds)); lastCheckpoint = time; lastPassCheckpoint = pass; }
      if (frames >= maxFrames || elapsed >= maxSeconds || (range.cycle && pass >= maxPasses)) {
        finishEnd = Math.min(c0 + maxSeconds, range.cycle ? c0 + maxPasses * (endSec - startSec) : Infinity);
        stopReason = limit.cloud ? t('app.music.beat.details.d36')
          : limit.passes && previousLanes + maxPasses === 8 ? t('app.music.beat.details.d27') : t('app.music.beat.details.d37');
        announce(stopReason); stop();
      }
    } catch (error) { failed(error); }
  });
  async function commit() {
    if (committed || !readyRows?.length) { failure = ''; onSettled(); return current(); }
    for (const row of readyRows) {
      // Revocation can race an IndexedDB open. Retry preservation under the new
      // generation, without ever attaching the audio to the read-only document.
      let saved = false;
      while (!saved) {
        const captured = capabilityGeneration();
        const check = () => { if (current().version === 5) assertBeatGeneration(captured); if (!revoked) assertBeatWritable(current()); };
        try { await persist(row, check); saved = true; }
        catch (error) { if (captured === capabilityGeneration()) throw error; revoked ||= beatReadOnly(current()); }
      }
    }
    if (revoked || beatReadOnly(current())) {
      committed = true; failure = ''; onSettled(); announce(t(BEAT_READ_ONLY_MESSAGE)); return current();
    }
    writable();
    const length = range.cycle ? range.length : readyRows[0].pending.length;
    const latest = current();
    if (latest.id !== doc.id) throw new Error('Open the original beat to recover these takes.');
    const next = commitRecording(latest, { trackId, start: range.start, length, single: !range.cycle, takes: readyRows.map(row => ({ asset: takeAsset(row) })) });
    const count = next.tracks.find(t => t.id === trackId).takeGroups.find(g => g.start === range.start && g.length === length).lanes.length;
    if (!edit(() => next, { recordingCommit: true, label: `Recorded ${readyRows.length} takes`, message: t('app.music.beat.details.d35', { count: readyRows.length, take: count }) })) throw new Error('Could not commit the recorded takes. Try again.');
    committed = true; failure = ''; onSettled(); return next;
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
          try { early = !await drain(capture, end, rtt); } catch { early = true; }
          unsubscribe(); unsubscribeWrites(); await writing;
          const parts = split(end), kept = parts.filter(p => !range.cycle || p.complete || p.samples.length >= sr);
          if (kept.length < parts.length) announce(t('app.music.beat.details.d38'));
          readyRows = kept.map(p => rowFor(p, range.cycle ? range.length : Math.floor(p.samples.length / sr / tickSeconds(240, bpm)) * 240)).filter(r => r.pending.length >= 240);
          chunks.length = 0; windows.length = 0;
          await discard([...ids.values()].filter(id => !readyRows.some(r => r.id === id)));
          const result = await commit();
          if (stopReason && !revoked) announce(stopReason);
          if (early && !revoked) announce(t('app.music.beat.details.d39', { bar: Math.floor((range.start + (readyRows.at(-1)?.pending.length || 0)) / 3840) + 1 }));
          return result;
        } catch (e) { failure = e.message; announce(e.message); return current(); }
        finally { unsubscribe(); unsubscribeWrites(); onState({ status: failure ? 'error' : 'armed', error: failure }); }
      })();
      return finishPromise;
    },
    async discard() {
      try {
        unsubscribeWrites();
        await writing;
        await discard([...ids.values()]);
        failure = ''; readyRows = []; chunks.length = 0; windows.length = 0; onSettled();
        onState({ status: 'armed', error: '' }); return current();
      } catch (e) { failure = e.message; onState({ status: 'error', error: failure }); return current(); }
    },
    async retry() { try { const result = await commit(); onState({ status: 'armed', error: '' }); return result; } catch (e) { failure = e.message; onState({ status: 'error', error: failure }); return current(); } },
  };
}
