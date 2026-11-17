import { beatEnglish, beatText } from './beatDisplay.mjs';
import { edit, trackById, BeatRefusal } from './beatOps.mjs';
import { insertMidiRegion } from './beatMidiOps.mjs';
import { noteCount, noteKey, quantisedNote, resolveNotes } from './beatMidiRules.mjs';
import { modulo } from './beatAudioSegments.mjs';
import { partitionTake, recordingEndTick } from './beatTakePartition.mjs';
import { createBeat } from './beatDocument.mjs';
export { contextTimeToSongTick } from './beatMidiWindow.mjs';
export { partitionTake, recordingEndTick } from './beatTakePartition.mjs';
const MAX = 64 * 3840;
export function recordingSequence(doc, locator, countIn = false) {
  const start = Math.floor(locator / 240) * 240;
  return { doc: { ...doc, view: 'song' }, recording: true, startStep: (start - (countIn ? 3840 : 0)) / 240,
    endStep: recordingEndTick(doc.tempo.bpm) / 240, loop: null, recordStart: start };
}
function targetRegion(doc, trackId, tick) { return trackById(doc, trackId).regions.find((r) => r.start <= tick && tick < r.start + r.length); }
export function takeAllocation(doc, take, announce = () => {}, t = beatEnglish) {
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
      groups.push(...partitionTake(notes, gapStart, Math.min(region.start, take.endLimit), announce, t).map((group) => ({ ...group, gapStart })));
    }
    gapStart = Math.max(gapStart, region.start + region.length);
  }
  return { existing, groups };
}
export function commitTake(doc, take, now = Date.now(), announce = () => {}, t = beatEnglish) {
  if (!take.notes.length) return doc;
  return edit(doc, now, (d) => {
    const track = trackById(d, take.trackId);
    if (track.kind !== 'midi') throw new BeatRefusal('The recording needs a MIDI track.');
    const { existing, groups } = takeAllocation(d, take, announce, t);
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
export function takeAsNewBeat(source, take, { id, now = Date.now() }) {
  const doc = createBeat({ id, title: 'Recorded take', now });
  for (const field of ['tempo', 'swing', 'signature', 'steps']) doc[field] = structuredClone(source[field]);
  const track = source.tracks.find((t) => t.id === take.trackId);
  doc.tracks = [{ id: 't1', name: take.name, kind: 'midi', instrument: structuredClone(take.instrument),
    gain: track?.gain ?? 1, pan: track?.pan ?? 0, mute: false, solo: false, regions: [] }];
  return commitTake(doc, { ...take, trackId: 't1' }, now);
}
// Pending state is deliberately outside the document. Capture never rebuilds a scheduler.
export function createRecording(doc, trackId, startTick, { snap = 0, announce = () => {}, t = beatEnglish } = {}) {
  const source = doc.tracks.find((t) => t.id === trackId);
  const take = { instrument: source?.instrument, name: source?.name || 'Recorded take', trackId, startTick, endLimit: recordingEndTick(doc.tempo.bpm), snap, notes: [] };
  const held = new Map(), notices = new Set(), splitNotices = new Set();
  const projectNotes = noteCount(doc), barCounts = new Map(), clipCounts = new Map();
  const availableClips = 64 - Object.keys(doc.clips).length;
  const availableRegions = 400 - doc.tracks.reduce((n, t) => n + t.regions.length, 0);
  const gaps = [], regions = source?.regions || [];
  let gapStart = Math.floor(startTick / 3840) * 3840, reserved = 0;
  for (const region of [...regions, { start: take.endLimit, length: 0 }]) {
    if (region.start > gapStart) gaps.push({ start: gapStart, end: Math.min(region.start, take.endLimit), clips: [] });
    gapStart = Math.max(gapStart, region.start + region.length);
  }
  let accepting = true, finalized = false, failure = null;
  const tell = (message) => { if (!notices.has(message)) { notices.add(message); announce(message); } };
  const limit = (reason) => { accepting = false; tell(t('app.music.beat.shared.limitReason', { reason: beatText(reason, t) })); };
  function update(tick) {
    for (const [key, note] of held) {
      note.end = Math.min(take.endLimit, note.start + MAX, Math.max(note.start + 30, Math.round(tick)));
      if (tick >= note.start + MAX) { held.delete(key); tell(t('app.music.beat.shared.heldNote')); }
    }
  }
  function reservationError() {
    if (reserved >= availableClips) return 'Clip limit reached';
    if (reserved >= availableRegions) return 'Region limit reached';
    return null;
  }
  // Count onsets incrementally. Only a prospective clip boundary inspects its
  // own notes; sorting and full take partitioning are reserved for commit.
  function reserveNote(note) {
    const region = regions.find((r) => r.start <= note.start && note.start < r.start + r.length);
    if (region) {
      const count = clipCounts.get(region.clipId) ?? doc.clips[region.clipId].notes.length;
      if (count >= 2000) return 'Clip note limit reached';
      clipCounts.set(region.clipId, count + 1);
      return null;
    }
    const gap = gaps.find((g) => g.start <= note.start && note.start < g.end);
    if (!gap) return 'No room for a recorded region';
    let clip = gap.clips.find((c) => c.start <= note.start && note.start < c.end);
    if (!clip) {
      const error = reservationError();
      if (error) return error;
      const start = note.start >= gap.start + MAX ? Math.floor(note.start / 3840) * 3840 : gap.start;
      clip = { start, end: gap.end, count: 0, notes: [] };
      gap.clips.push(clip); reserved++;
    }
    while (note.start >= Math.floor((clip.start + MAX) / 3840) * 3840 || clip.count >= 2000) {
      const error = reservationError();
      if (error) return error;
      const timeBoundary = Math.floor((clip.start + MAX) / 3840) * 3840;
      const dense = clip.count >= 2000 && note.start < timeBoundary;
      const heldNotes = new Set(held.values());
      let line = dense ? Math.floor(note.start / 3840) * 3840 : timeBoundary;
      if (!dense) {
        for (let free = line; free > clip.start; free -= 3840) {
          if (!clip.notes.some((n) => n.start < free && (n.end > free || (n.end === free && heldNotes.has(n))))) { line = free; break; }
        }
      }
      if (line <= clip.start) return 'This bar has 2,000 onsets';
      const carry = clip.notes.filter((n) => n.start >= line);
      const previous = clip.notes.filter((n) => n.start < line);
      for (const n of previous) if (n.end > line || (n.end === line && heldNotes.has(n))) {
        // Preserve impossible sub-30-tick cuts for the existing recovery path.
        if (line - n.start >= 30) n.end = line;
        splitNotices.add(`Long notes were split at bar ${Math.floor(line / 3840) + 1}`);
        for (const [key, heldNote] of held) if (heldNote === n) held.delete(key);
      }
      const end = clip.end;
      clip.end = line; clip.notes = previous; clip.count = previous.length;
      const start = !carry.length && note.start >= line + MAX ? Math.floor(note.start / 3840) * 3840 : line;
      clip = { start, end, count: carry.length, notes: carry };
      gap.clips.push(clip); reserved++;
    }
    clip.notes.push(note); clip.count++;
    return null;
  }
  return {
    take, held,
    get error() { return failure; }, get accepting() { return accepting; },
    on(key, pitch, velocity, tick) {
      if (!Number.isFinite(tick) || !Number.isInteger(pitch) || !Number.isInteger(velocity) || velocity < 1 || velocity > 127 || finalized || !accepting || held.has(key) || tick < startTick || Math.round(tick) > take.endLimit - 30 || pitch < 21 || pitch > 108) return false;
      update(tick);
      if (projectNotes + take.notes.length >= 5000) { limit('Project note limit reached'); return false; }
      const start = Math.max(startTick, Math.round(tick)), bar = Math.floor(start / 3840);
      if ((barCounts.get(bar) || 0) >= 2000) { tell(t('app.music.beat.shared.limitReason', { reason: t('app.music.beat.recovery.r71') })); return false; }
      const note = { start, end: start + 30, pitch, velocity };
      const reason = reserveNote(note);
      if (reason) { limit(reason); return false; }
      take.notes.push(note); barCounts.set(bar, (barCounts.get(bar) || 0) + 1);
      held.set(key, note);
      return true;
    },
    off(key, tick) { update(tick); held.delete(key); }, update,
    finalize(currentDoc, tick, apply) {
      if (finalized) return currentDoc;
      update(tick); held.clear(); accepting = false;
      try {
        for (const message of splitNotices) tell(message);
        const next = commitTake(currentDoc, take, Date.now(), tell, t);
        if (next !== currentDoc && !apply(next, take.notes.length)) throw new Error('Could not commit the recorded take.');
        finalized = true; failure = null; return next;
      } catch (e) { failure = e.message; tell(e.message); return currentDoc; }
    },
  };
}
