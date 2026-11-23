// Typed access to the shared web MIDI rules. Keep edits and validation in that implementation.
// @ts-ignore shared JavaScript
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
// @ts-ignore shared JavaScript
import * as rules from '../../../../../app/veyrnox/_lib/music/beat/beatMidiRules.mjs';
// @ts-ignore shared JavaScript
import * as windowOps from '../../../../../app/veyrnox/_lib/music/beat/beatMidiWindow.mjs';
// @ts-ignore shared JavaScript
import * as beatOps from '../../../../../app/veyrnox/_lib/music/beat/beatOps.mjs';
// @ts-ignore shared JavaScript
import * as tables from '../../../../../app/veyrnox/_lib/music/beat/beatWavetable.js';
import { PRESETS, noteLabel, isBlackKey } from '../instrumentShared';
import { songEnd, type BeatDoc, type BeatTrackDoc } from './doc';

export type MidiNote = [number, number, number, number];
export type MidiClip = { name: string; lengthTicks: number; notes: MidiNote[] };
export type Instrument = { engine: 'voice' | 'wavetable'; id: string; preset: string };
export type MidiRegion = { id: string; start: number; length: number; clipId: string; phaseTicks: number };
export type MidiTrackDoc = Omit<BeatTrackDoc, 'kind' | 'regions'> & { kind: 'midi'; instrument: Instrument; regions: MidiRegion[] };
export type MidiDoc = BeatDoc & { clips: Record<string, MidiClip> };
export type MidiSoundTrack = { id: string; instrument: Instrument; gain: number; pan: number };
export const asMidiDoc = (doc: BeatDoc): MidiDoc => doc as MidiDoc;
export const { addMidiTrack, addMidiRegion, addNote, deleteNotes, moveNotes, resizeNotes, velocityNotes, quantiseNotes, setClipLength, makeUnique } = ops as {
    addMidiTrack(doc: BeatDoc, instrument: Instrument): BeatDoc;
    addMidiRegion(doc: BeatDoc, trackId: string, start: number): BeatDoc;
    addNote(doc: BeatDoc, clipId: string, note: MidiNote): BeatDoc;
    deleteNotes(doc: BeatDoc, clipId: string, keys: string[]): BeatDoc;
    moveNotes(doc: BeatDoc, clipId: string, keys: string[], ticks: number, pitch: number): BeatDoc;
    resizeNotes(doc: BeatDoc, clipId: string, keys: string[], delta: number): BeatDoc;
    velocityNotes(doc: BeatDoc, clipId: string, keys: string[], delta: number): BeatDoc;
    quantiseNotes(doc: BeatDoc, clipId: string, keys: string[], snap: number, strength: number): BeatDoc;
    setClipLength(doc: BeatDoc, clipId: string, length: number): BeatDoc;
    makeUnique(doc: BeatDoc, regionId: string): BeatDoc;
};
export const { noteKey, quantisedSelection, clipLengthFromBars, MIDI_LIMITS } = rules as {
    noteKey(note: MidiNote): string;
    quantisedSelection(clip: MidiClip, keys: string[], snap: number, strength: number): string[];
    clipLengthFromBars(draft: string): number | null;
    MIDI_LIMITS: { clips: number; clipNotes: number; notes: number; clipTicks: number };
};
export const { midiNoteOnsInWindow } = windowOps as {
    midiNoteOnsInWindow(doc: BeatDoc, fromSec: number, toSec: number, options?: { tempo?: number; endSec?: number; includeMuted?: boolean }): { trackId: string; pitch: number; velocity: number; songTimeSec: number; durationSec: number }[];
};
const { resizeRegion } = beatOps as { resizeRegion(doc: BeatDoc, regionId: string, length: number): BeatDoc };
export const { WAVETABLE_PRESETS } = tables as { WAVETABLE_PRESETS: Record<string, { label: string }> };
export { PRESETS, noteLabel, isBlackKey };
export const midiTracks = (doc: BeatDoc): MidiTrackDoc[] => doc.tracks.filter(t => t.kind === 'midi') as MidiTrackDoc[];
export const midiRegions = (doc: BeatDoc) => midiTracks(doc).flatMap(track => track.regions.map(region => ({ track, region, clip: asMidiDoc(doc).clips?.[region.clipId] })));
export const midiTrackSections = (doc: BeatDoc) => midiTracks(doc).map(track => {
    const clips = new Map<string, { region: MidiRegion; clip: MidiClip }>();
    for (const region of track.regions) {
        const clip = asMidiDoc(doc).clips?.[region.clipId];
        if (clip && !clips.has(region.clipId)) clips.set(region.clipId, { region, clip });
    }
    return { track, clips: [...clips.values()] };
});
export const regionUses = (doc: BeatDoc, clipId: string): number => midiRegions(doc).filter(x => x.region.clipId === clipId).length;
export function addInstrumentTrack(doc: BeatDoc, instrument: Instrument): BeatDoc {
    const length = Math.max(doc.steps * 240, songEnd(doc));
    const added = addMidiTrack(doc, instrument);
    const withRegion = addMidiRegion(added, added.tracks[added.tracks.length - 1].id, 0);
    const region = withRegion.tracks[withRegion.tracks.length - 1].regions[0];
    return region.length === length ? withRegion : resizeRegion(withRegion, region.id, length);
}
export const INSTRUMENT_GROUPS = [
    ...Object.entries(PRESETS).map(([id, presets]) => ({ id, presets: presets.map(p => ({ label: p.label, instrument: { engine: 'voice', id, preset: p.id } as Instrument })) })),
    { id: 'wavetable', presets: Object.entries(WAVETABLE_PRESETS).map(([preset, p]) => ({ label: p.label, instrument: { engine: 'wavetable', id: 'wavetable', preset } as Instrument })) },
];
export const filterInstruments = (query: string) => INSTRUMENT_GROUPS.map(group => ({ ...group, presets: group.presets.filter(p => `${group.id} ${p.label}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter(g => g.presets.length);
export const instrumentLabel = (instrument: Instrument): string => INSTRUMENT_GROUPS.find(g => g.id === instrument.id)?.presets.find(p => p.instrument.preset === instrument.preset)?.label ?? instrument.preset;
/** Same position/pitch clamps as moveNotes; collisions retain the selected note in the shared op. */
export const movedSelection = (clip: MidiClip, keys: string[], ticks: number, pitch: number): string[] => [...new Set(clip.notes.filter(n => keys.includes(noteKey(n))).map(n => `${Math.max(0, Math.min(clip.lengthTicks - n[1], n[0] + ticks))}:${Math.max(21, Math.min(108, n[2] + pitch))}`))];

/** Preserve the selection outside the edit and discard keys absent from the committed clip. */
export function selectionAfterMove(before: MidiClip, committed: MidiClip, selection: string[], moved: string[], ticks: number, pitch: number): string[] {
    const edited = new Set(moved), present = new Set(committed.notes.map(noteKey));
    const kept = selection.filter(key => !edited.has(key));
    const remapped = movedSelection(before, selection.filter(key => edited.has(key)), ticks, pitch);
    return [...new Set([...kept, ...remapped])].filter(key => present.has(key));
}
