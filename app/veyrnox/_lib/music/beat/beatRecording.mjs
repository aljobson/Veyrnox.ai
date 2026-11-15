import { edit, trackById, BeatRefusal } from './beatOps.mjs';
import { insertMidiRegion } from './beatMidiOps.mjs';
import { noteCount, noteKey, quantisedNote, resolveNotes } from './beatMidiRules.mjs';
import { modulo } from './beatAudioSegments.mjs';
import { partitionTake, recordingEndTick } from './beatTakePartition.mjs';
export { contextTimeToSongTick } from './beatMidiWindow.mjs';
export { partitionTake, recordingEndTick } from './beatTakePartition.mjs';
const MAX = 64 * 3840;
export function recordingSequence(doc, locator, countIn = false) {
  const start = Math.floor(locator / 240) * 240;
  return { doc: { ...doc, view: 'song' }, recording: true, startStep: (start - (countIn ? 3840 : 0)) / 240,
    endStep: recordingEndTick(doc.tempo.bpm) / 240, loop: null, recordStart: start };
}
function targetRegion(doc, trackId, tick) { return trackById(doc, trackId).regions.find((r) => r.start <= tick && tick < r.start + r.length); }
export function takeAllocation(doc, take, announce = () => {}) {
  const existing = new Map(), empty = [];
  for (const n of take.notes) {
    const region = targetRegion(doc, take.trackId, n.start);
    if (region) {
      const list = existing.get(region.id) || []; list.push(n); existing.set(region.id, list);
    } else empty.push(n);
  }
  // Gaps are bounded by existing regions, so adding a take never overwrites one.
  const track = trackById(doc, take.trackId), groups = [];
  let gapStart = Math.floor(take.startTick / 3840) * 3840;
  for (const region of [...track.regions, { start: take.endLimit, length: 0 }]) {
    if (region.start > gapStart) {
      const notes = empty.filter((n) => n.start >= gapStart && n.start < region.start);
      groups.push(...partitionTake(notes, gapStart, Math.min(region.start, take.endLimit), announce).map((group) => ({ ...group, gapStart })));
    }
    gapStart = Math.max(gapStart, region.start + region.length);
  }
  return { existing, groups };
}
export function commitTake(doc, take, now = Date.now(), announce = () => {}) {
  if (!take.notes.length) return doc;
  return edit(doc, now, (d) => {
    const track = trackById(d, take.trackId);
    if (track.kind !== 'midi') throw new BeatRefusal('The recording needs a MIDI track.');
    const { existing, groups } = takeAllocation(d, take, announce);
    for (const [regionId, notes] of existing) {
      const region = track.regions.find((r) => r.id === regionId), clip = d.clips[region.clipId];
      const entries = clip.notes.map((n) => ({ note: n, selected: false, original: n[0] }));
      for (const n of notes) {
        const start = modulo(n.start - region.start + region.phaseTicks, clip.lengthTicks);
        const length = Math.min(n.end - n.start, clip.lengthTicks - start, region.start + region.length - n.start);
        if (length < 30) throw new BeatRefusal('A recorded note is too close to a clip boundary. Save the take as a new beat.');
        let note = [start, length, n.pitch, n.velocity];
        if (take.snap) note = quantisedNote(note, clip.lengthTicks, take.snap, 1, false);
        entries.push({ note, selected: true, original: start });
      }
      if (!take.snap && new Set(entries.map((e) => noteKey(e.note))).size !== entries.length) throw new BeatRefusal('Recording repeats a note at the same clip position and pitch. Save the take as a new beat.');
      clip.notes = resolveNotes(entries);
    }
    for (const group of groups) {
      if (group.start < group.gapStart) throw new BeatRefusal('This recording gap starts inside a bar. Save the take as a new beat.');
      const length = group.end - group.start;
      const notes = group.notes.map((n) => {
        const note = [n.start - group.start, n.end - n.start, n.pitch, n.velocity];
        if (note[1] < 30) throw new BeatRefusal('A recorded note crosses a partition boundary. Save the take as a new beat.');
        return take.snap ? quantisedNote(note, length, take.snap, 1, false) : note;
      });
      if (!take.snap && new Set(notes.map(noteKey)).size !== notes.length) throw new BeatRefusal('Recorded notes share the same position and pitch. Try again with recording quantise enabled.');
      insertMidiRegion(d, track.id, group.start, length,
        resolveNotes(notes.map((note) => ({ note, selected: true, original: note[0] }))), `${track.name} take`);
    }
  });
}
// Pending state is deliberately outside the document. Capture never rebuilds a scheduler.
export function createRecording(doc, trackId, startTick, { snap = 0, announce = () => {} } = {}) {
  const source = doc.tracks.find((t) => t.id === trackId);
  const take = { instrument: source?.instrument, name: source?.name || 'Recorded take', trackId, startTick, endLimit: recordingEndTick(doc.tempo.bpm), snap, notes: [] };
  const held = new Map(), notices = new Set(), cuts = new Set();
  let accepting = true, finalized = false, failure = null;
  const tell = (message) => { if (!notices.has(message)) { notices.add(message); announce(message); } };
  const limit = (reason) => { accepting = false; tell(`Recording limit reached — stop to save. ${reason}`); };
  function update(tick) {
    for (const [key, note] of held) {
      note.end = Math.min(...[...cuts].filter((line) => line >= note.start + 30), take.endLimit, note.start + MAX, Math.max(note.start + 30, Math.round(tick)));
      if (tick >= note.start + MAX) { held.delete(key); tell('Held note ended at 64 bars'); }
      else if ([...cuts].some((line) => line > note.start && tick >= line)) held.delete(key);
    }
  }
  function checkCapacity() {
    const { groups, existing } = takeAllocation(doc, take);
    if (Object.keys(doc.clips).length + groups.length > 64) return 'Clip limit reached';
    if (doc.tracks.reduce((n, t) => n + t.regions.length, 0) + groups.length > 400) return 'Region limit reached';
    for (const [id, notes] of existing) {
      const region = targetRegion(doc, trackId, notes[0].start);
      if (region.id === id && doc.clips[region.clipId].notes.length + notes.length > 2000) return 'Clip note limit reached';
    }
    return null;
  }
  return {
    take, held,
    get error() { return failure; }, get accepting() { return accepting; },
    on(key, pitch, velocity, tick) {
      if (!Number.isFinite(tick) || !Number.isInteger(pitch) || !Number.isInteger(velocity) || velocity < 1 || velocity > 127 || finalized || !accepting || held.has(key) || tick < startTick || Math.round(tick) > take.endLimit - 30 || pitch < 21 || pitch > 108) return false;
      update(tick);
      if (noteCount(doc) + take.notes.length >= 5000) { limit('Project note limit reached'); return false; }
      const start = Math.max(startTick, Math.round(tick)), bar = Math.floor(start / 3840);
      if (take.notes.filter((n) => Math.floor(n.start / 3840) === bar).length >= 2000) { tell('Recording limit reached — stop to save. This bar has 2,000 onsets'); return false; }
      const note = { start, end: start + 30, pitch, velocity };
      take.notes.push(note);
      let reason;
      try { reason = checkCapacity(); } catch (e) { reason = e.message; }
      if (reason) { take.notes.pop(); limit(reason); return false; }
      held.set(key, note);
      const { groups } = takeAllocation(doc, take, tell);
      for (const group of groups.slice(1)) {
        const line = group.start;
        cuts.add(line);
        for (const [heldKey, n] of held) if (n.start < line && n.end > line) { if (line - n.start >= 30) n.end = line; held.delete(heldKey); }
      }
      return true;
    },
    off(key, tick) { update(tick); held.delete(key); }, update,
    finalize(currentDoc, tick, apply) {
      if (finalized) return currentDoc;
      update(tick); held.clear(); accepting = false;
      try {
        const next = commitTake(currentDoc, take, Date.now(), tell);
        if (next !== currentDoc && !apply(next, take.notes.length)) throw new Error('Could not commit the recorded take.');
        finalized = true; failure = null; return next;
      } catch (e) { failure = e.message; tell(e.message); return currentDoc; }
    },
  };
}
