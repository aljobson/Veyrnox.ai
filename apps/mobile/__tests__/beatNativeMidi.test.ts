import { createBeat, songEnd, tryOp, validateBeat } from '../src/lib/beatNative/doc';
import { addInstrumentTrack, addMidiRegion, addNote, asMidiDoc, filterInstruments, INSTRUMENT_GROUPS, instrumentLabel, makeUnique, midiRegions, movedSelection, selectionAfterMove, moveNotes, noteKey, quantisedSelection, quantiseNotes, regionUses, resizeNotes, setClipLength, velocityNotes, deleteNotes, type Instrument } from '../src/lib/beatNative/midi';
import { createHistory, record, replacePresent, travel } from '../src/lib/beatNative/history';
import { createBeatStore } from '../src/lib/beatNative/store';
import { memoryFiles, PROJECT } from './beatNativeFixtures';
import { xToTick } from '../src/lib/beatNative/rollGeometry';
const instrument: Instrument = { engine: 'voice', id: 'piano', preset: 'grand' };
const fixture = () => addInstrumentTrack(createBeat({ id: PROJECT }), instrument);
test('every library instrument creates a valid v4 track and a region spanning the song', () => {
    for (const group of INSTRUMENT_GROUPS) for (const preset of group.presets) {
        const doc = addInstrumentTrack(createBeat({ id: PROJECT }), preset.instrument);
        const row = midiRegions(doc)[0];
        expect(validateBeat(doc).ok).toBe(true);
        expect(doc.version).toBe(4); expect(row.region.length).toBe(Math.max(doc.steps * 240, songEnd(doc)));
        expect(row.track.instrument).toEqual(preset.instrument);
        expect(instrumentLabel(preset.instrument)).toBe(preset.label);
    }
    expect(filterInstruments('GRAND').flatMap(g => g.presets)).toHaveLength(1);
    expect(filterInstruments('nonexistent')).toEqual([]);
});
test('store commits the compound add as one history entry, autosaves and undoes', async () => {
    const files = memoryFiles(), store = createBeatStore(files), original = store.newBeat('MIDI');
    let history = createHistory(original);
    const result = tryOp(original, d => addInstrumentTrack(d, instrument));
    expect(result.refused).toBeUndefined(); expect(store.putBeat(result.doc)).toBe(true);
    history = record(history, store.getBeat(original.id)!);
    expect(history.past).toHaveLength(1);
    await store.flushBeats(); expect([...files.data.values()][0]).toContain('grand');
    const prior = travel(history, 'undo'); expect(store.putBeat(prior.present)).toBe(true);
    history = replacePresent(prior, store.getBeat(original.id)!);
    expect(history.present.tracks).toHaveLength(1);
    store.resetBeats();
});
test('end cell has 30 ticks left, move and quantise remap selection, edit ops remain valid', () => {
    let doc = fixture(); const { region } = midiRegions(doc)[0], id = region.clipId;
    const tick = xToTick(381, 0.1, 240, 3840);
    doc = addNote(doc, id, [tick, Math.min(240, 3840 - tick), 60, 100]);
    expect(asMidiDoc(doc).clips[id].notes).toEqual([[3810, 30, 60, 100]]);
    let clip = asMidiDoc(doc).clips[id], keys = clip.notes.map(noteKey);
    const moved = movedSelection(clip, keys, -260, 60);
    doc = moveNotes(doc, id, keys, -260, 60);
    expect(asMidiDoc(doc).clips[id].notes.map(noteKey)).toEqual(moved);
    clip = asMidiDoc(doc).clips[id]; keys = moved;
    const quantised = quantisedSelection(clip, keys, 240, 0.5);
    doc = quantiseNotes(doc, id, keys, 240, 0.5);
    expect(asMidiDoc(doc).clips[id].notes.map(noteKey)).toEqual(quantised);
    doc = velocityNotes(doc, id, quantised, 50); doc = resizeNotes(doc, id, quantised, 240);
    expect(validateBeat(doc).ok).toBe(true);
    doc = deleteNotes(doc, id, quantised); expect(asMidiDoc(doc).clips[id].notes).toEqual([]);
});
test('quantisation collision retains selected note and clip shortening trims notes', () => {
    let doc = fixture(); const id = midiRegions(doc)[0].region.clipId;
    doc = addNote(doc, id, [240, 240, 60, 120]); doc = addNote(doc, id, [250, 240, 60, 64]);
    doc = quantiseNotes(doc, id, ['250:60'], 240, 1);
    expect(asMidiDoc(doc).clips[id].notes).toEqual([[240, 240, 60, 64]]);
    doc = setClipLength(doc, id, 240); expect(asMidiDoc(doc).clips[id].notes).toEqual([]);
    expect(validateBeat(doc).ok).toBe(true);
});
test('make unique copies the clip and limits refuse without mutation', () => {
    let doc = fixture(); const { region } = midiRegions(doc)[0];
    const next = makeUnique(doc, region.id), newId = midiRegions(next)[0].region.clipId;
    expect(newId).not.toBe(region.clipId); expect(regionUses(next, newId)).toBe(1);
    expect(asMidiDoc(next).clips[newId]).toEqual(asMidiDoc(doc).clips[region.clipId]);
    for (let i = 0; i < 14; i++) doc = addInstrumentTrack(doc, instrument);
    const refused = tryOp(doc, d => addInstrumentTrack(d, instrument));
    expect(refused.refused).toBeTruthy(); expect(refused.doc).toBe(doc);
    let clips = fixture(); for (let i = 1; i < 64; i++) clips = addMidiRegion(clips, midiRegions(clips)[0].track.id, (i + 3) * 3840);
    expect(Object.keys(asMidiDoc(clips).clips)).toHaveLength(64);
    expect(tryOp(clips, d => addInstrumentTrack(d, instrument)).refused).toBeTruthy();
});


test('selection reconciliation keeps unmoved keys, remaps only selected edits and filters committed collisions', () => {
    let doc = fixture(); const id = midiRegions(doc)[0].region.clipId;
    doc = addNote(doc, id, [0, 240, 60, 100]);
    doc = addNote(doc, id, [240, 240, 60, 90]);
    doc = addNote(doc, id, [480, 240, 64, 80]);
    const before = asMidiDoc(doc).clips[id];
    const after = asMidiDoc(moveNotes(doc, id, ['0:60'], 240, 0)).clips[id];
    expect(after.notes).toHaveLength(2);
    expect(selectionAfterMove(before, after, ['0:60', '480:64'], ['0:60'], 240, 0).sort()).toEqual(['240:60', '480:64']);
    expect(selectionAfterMove(before, after, ['480:64'], ['0:60'], 240, 0)).toEqual(['480:64']);
    const removed = { ...after, notes: after.notes.filter(n => noteKey(n) !== '480:64') };
    expect(selectionAfterMove(before, removed, ['0:60', '480:64'], ['0:60'], 240, 0)).toEqual(['240:60']);
});
