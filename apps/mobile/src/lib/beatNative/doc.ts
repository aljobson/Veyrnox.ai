// One typed seam over the shared web beat document (app/veyrnox/_lib/music/beat/*). Nothing is copied: the phone edits the
// same v4 document with the same ops, so a rule fixed on the web lands here. Pattern: src/lib/instrumentShared.ts.
// @ts-ignore plain-JS web modules, typed by the casts below
import * as document from '../../../../../app/veyrnox/_lib/music/beat/beatDocument.mjs';
// @ts-ignore see above
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatOps.mjs';
// @ts-ignore see above
import * as events from '../../../../../app/veyrnox/_lib/music/beat/beatEvents.mjs';
// @ts-ignore see above
import * as time from '../../../../../app/veyrnox/_lib/music/beat/beatTime.mjs';
// @ts-ignore see above
import * as instruments from '../../../../../lib/musicInstruments.js';

import type { TakeAsset, TakeGroup } from './takeShared';

export type PadId = 'kick' | 'snare' | 'hat' | 'openhat' | 'clap' | 'tom' | 'rim' | 'crash';
export type Hit = [step: number, velocity: number];
export type BeatTrackDoc = { id: string; name: string; kind?: string; kit: string; mute: boolean; solo: boolean; gain: number; pan: number; takeGroups?: TakeGroup[]; regions: { id: string; start: number; length: number }[] };
export type BeatDoc = {
    kind: string; version: number; id: string; title: string; createdAt: number; updatedAt: number;
    tempo: { bpm: number }; swing: number; steps: number; currentPattern: string;
    cycle?: { on: boolean; start: number; end: number }; assets?: Record<string, TakeAsset>;
    patterns: Record<string, { rows: Partial<Record<PadId, Hit[]>> }>; tracks: BeatTrackDoc[];
};
export type PadInfo = { id: PadId; label: string };
export type KitInfo = { id: string; label: string; hint: string };
export type StepEvent = { trackId: string; pad: PadId; velocity: number };
export type Edit = (doc: BeatDoc) => BeatDoc;

const d = document as unknown as {
    BEAT_LIMITS: { bpm: [number, number]; tracks: number };
    createBeat(input: { id: string; title?: string; now?: number }): BeatDoc;
    validateBeat(doc: unknown): { ok: boolean };
    songEnd(doc: BeatDoc): number;
};
const o = ops as unknown as {
    toggleStep: (doc: BeatDoc, pad: PadId, step: number) => BeatDoc;
    setTempo: (doc: BeatDoc, bpm: number) => BeatDoc;
    rename: (doc: BeatDoc, title: string) => BeatDoc;
    addTrack: (doc: BeatDoc, kit: string) => BeatDoc;
    removeTrack: (doc: BeatDoc, id: string) => BeatDoc;
    addRegion: (doc: BeatDoc, trackId: string, start: number, pattern: string) => BeatDoc;
    resizeRegion: (doc: BeatDoc, id: string, length: number) => BeatDoc;
    setTrackKit: (doc: BeatDoc, id: string, kit: string) => BeatDoc;
    setTrackMute: (doc: BeatDoc, id: string, value: boolean) => BeatDoc;
    setTrackSolo: (doc: BeatDoc, id: string, value: boolean) => BeatDoc;
    setTrackGain: (doc: BeatDoc, id: string, value: number) => BeatDoc;
    setTrackPan: (doc: BeatDoc, id: string, value: number) => BeatDoc;
    tryOp: (doc: BeatDoc, operation: Edit) => { doc: BeatDoc; refused?: string };
    nextId: (doc: BeatDoc, prefix: string) => string;
};
const e = events as unknown as { eventsAtStep: (doc: BeatDoc, step: number) => StepEvent[] };
const t = time as unknown as { eventTime: (straight: number, step: number, bpm: number, swing: number) => number; stepSeconds: (bpm: number) => number };
const i = instruments as unknown as { DRUM_PADS: PadInfo[]; PRESETS: { drums: KitInfo[] } };

export const { BEAT_LIMITS, createBeat, validateBeat, songEnd } = d;
export const { toggleStep, setTempo, rename, removeTrack, setTrackKit, setTrackMute, setTrackSolo, setTrackGain, setTrackPan, tryOp } = o;
export const { eventsAtStep } = e;
export const { eventTime, stepSeconds } = t;
export const DRUM_PADS: readonly PadInfo[] = i.DRUM_PADS;
export const DRUM_KITS: readonly KitInfo[] = i.PRESETS.drums;
export const STEP_TICKS = 240;
export const MIN_BPM = BEAT_LIMITS.bpm[0];
export const MAX_BPM = BEAT_LIMITS.bpm[1];
export const MAX_TRACKS = BEAT_LIMITS.tracks;

/** Steps in one loop of the song (a default beat is four bars of sixteen). */
export const loopSteps = (doc: BeatDoc): number => Math.max(doc.steps, Math.round(songEnd(doc) / STEP_TICKS));

/** A drum track that sounds: the web `addTrack` makes an empty one, so give it a region as long as the loop. */
export function addKitTrack(doc: BeatDoc, kit: string): BeatDoc {
    const length = Math.max(doc.steps * STEP_TICKS, songEnd(doc));
    const withTrack = o.addTrack(doc, kit);
    const track = withTrack.tracks[withTrack.tracks.length - 1];
    const withRegion = o.addRegion(withTrack, track.id, 0, doc.currentPattern);
    const region = withRegion.tracks[withRegion.tracks.length - 1].regions[0];
    return region.length === length ? withRegion : o.resizeRegion(withRegion, region.id, length);
}

export const hitsFor = (doc: BeatDoc, pad: PadId): readonly Hit[] => doc.patterns[doc.currentPattern]?.rows[pad] ?? [];
export const hasHit = (doc: BeatDoc, pad: PadId, step: number): boolean => hitsFor(doc, pad).some(([s]) => s === step);
export const kitLabel = (id: string): string => DRUM_KITS.find(k => k.id === id)?.label ?? id;
export const anySolo = (doc: BeatDoc): boolean => doc.tracks.some(track => track.solo);
/** Gain the strip should carry: mute and solo fold in, as the web song view does. */
export const audibleGain = (doc: BeatDoc, track: BeatTrackDoc): number => track.mute || (anySolo(doc) && !track.solo) ? 0 : track.gain;
