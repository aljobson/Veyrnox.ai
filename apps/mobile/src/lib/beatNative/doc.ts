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
export type PatternSlot = 'A' | 'B' | 'C' | 'D';
export type StepCount = 16 | 32;
export type Hit = [step: number, velocity: number];
export type BeatPattern = { rows: Partial<Record<PadId, Hit[]>> };
export type BeatRegionDoc = {
    id: string; start: number; length: number; offset?: number; pattern?: PatternSlot; assetId?: string; clipId?: string;
    phaseSec?: number; phaseTicks?: number; tailSec?: number;
    gainDb?: number; fadeIn?: { startSec: number; endSec: number } | null;
    fadeOut?: { startBeforeEndSec: number; endBeforeEndSec: number } | null; reverse?: boolean;
};
type BeatRemoteMetadata = {
    ref: Record<string, string>; name: string; durationSec: number; bpm: number | null; sourceChannels: number; encodedBytes: number;
};
export type BeatRemoteAsset = ({ source: 'song' | 'target' } & BeatRemoteMetadata) | ({ source: 'stem' } & BeatRemoteMetadata);
export type BeatSoundAsset = {
    source: 'sound'; ref: string; name: string;
    durationSec: number; bpm: number | null; sourceChannels: number; encodedBytes: number;
};
export type BeatAsset = TakeAsset | BeatRemoteAsset | BeatSoundAsset;
export type BeatCycle = { on: boolean; start: number; end: number };
export type BeatTrackDoc = { id: string; name: string; kind?: 'drums' | 'audio' | 'midi'; kit?: string; mute: boolean; solo: boolean; gain: number; pan: number; takeGroups?: TakeGroup[]; regions: BeatRegionDoc[] };
export type BeatDoc = {
    kind: string; version: number; id: string; title: string; createdAt: number; updatedAt: number;
    view: 'pattern' | 'song'; cycle: BeatCycle; assets?: Record<string, BeatAsset>; clips?: Record<string, { name: string }>;
    tempo: { bpm: number }; signature: [4, 4]; swing: number; metronome: boolean; steps: StepCount; currentPattern: PatternSlot;
    patterns: Record<PatternSlot, BeatPattern>; tracks: BeatTrackDoc[];
};
export type PadInfo = { id: PadId; label: string };
export type KitInfo = { id: string; label: string; hint: string };
export type StepEvent = { trackId: string; pad: PadId; velocity: number };
export type RecordTarget = { pattern: PatternSlot; step: number };
export type Edit = (doc: BeatDoc) => BeatDoc;

const d = document as unknown as {
    BEAT_LIMITS: { bpm: readonly [number, number]; swing: readonly [number, number]; steps: readonly StepCount[]; patterns: readonly PatternSlot[]; tracks: number };
    createBeat(input: { id: string; title?: string; now?: number }): BeatDoc;
    validateBeat(doc: unknown): { ok: boolean };
    songEnd(doc: BeatDoc): number;
};
const o = ops as unknown as {
    BeatRefusal: new (message: string, code?: string) => Error & { code?: string };
    toggleStep: (doc: BeatDoc, pad: PadId, step: number) => BeatDoc;
    cycleVelocity: (doc: BeatDoc, pad: PadId, step: number, direction?: number) => BeatDoc;
    addHitToPattern: (doc: BeatDoc, pattern: PatternSlot, pad: PadId, step: number) => BeatDoc;
    setTempo: (doc: BeatDoc, bpm: number) => BeatDoc;
    rename: (doc: BeatDoc, title: string) => BeatDoc;
    renameTrack: (doc: BeatDoc, id: string, name: string) => BeatDoc;
    addTrack: (doc: BeatDoc, kit: string) => BeatDoc;
    removeTrack: (doc: BeatDoc, id: string) => BeatDoc;
    addRegion: (doc: BeatDoc, trackId: string, start: number, pattern: PatternSlot) => BeatDoc;
    resizeRegion: (doc: BeatDoc, id: string, length: number) => BeatDoc;
    setTrackKit: (doc: BeatDoc, id: string, kit: string) => BeatDoc;
    setTrackMute: (doc: BeatDoc, id: string, value: boolean) => BeatDoc;
    setTrackSolo: (doc: BeatDoc, id: string, value: boolean) => BeatDoc;
    setTrackGain: (doc: BeatDoc, id: string, value: number) => BeatDoc;
    setTrackPan: (doc: BeatDoc, id: string, value: number) => BeatDoc;
    tryOp: (doc: BeatDoc, operation: Edit) => { doc: BeatDoc; refused?: string; code?: string };
    moveRegion: (doc: BeatDoc, id: string, start: number, trackId: string) => BeatDoc;
    copyRegion: (doc: BeatDoc, id: string, start: number, trackId: string) => BeatDoc;
    trimRegionStart: (doc: BeatDoc, id: string, start: number) => BeatDoc;
    splitRegion: (doc: BeatDoc, id: string, at: number) => BeatDoc;
    duplicateRegion: (doc: BeatDoc, id: string) => BeatDoc;
    deleteRegion: (doc: BeatDoc, id: string) => BeatDoc;
    setRegionPattern: (doc: BeatDoc, id: string, pattern: PatternSlot) => BeatDoc;
    selectPattern: (doc: BeatDoc, pattern: PatternSlot) => BeatDoc;
    setSwing: (doc: BeatDoc, value: number) => BeatDoc;
    setSteps: (doc: BeatDoc, steps: StepCount) => BeatDoc;
    copyPattern: (doc: BeatDoc, from: PatternSlot, to: PatternSlot) => BeatDoc;
    clearPattern: (doc: BeatDoc) => BeatDoc;
    setMetronome: (doc: BeatDoc, enabled: boolean) => BeatDoc;
    setCycle: (doc: BeatDoc, cycle: BeatCycle) => BeatDoc;
    setView: (doc: BeatDoc, view: BeatDoc['view']) => BeatDoc;
    setAudioRegion: (doc: BeatDoc, id: string, patch: Pick<BeatRegionDoc, 'gainDb' | 'fadeIn' | 'fadeOut' | 'reverse'>) => BeatDoc;
    addAudioRegion: (doc: BeatDoc, asset: Record<string, unknown>, trackId: string | null, start: number) => BeatDoc;
    nextId: (doc: BeatDoc, prefix: string) => string;
};
const e = events as unknown as {
    eventsAtStep: (doc: BeatDoc, step: number) => StepEvent[];
    recordTarget: (doc: BeatDoc, globalStep: number, editTrackId?: string) => RecordTarget | null;
};
const t = time as unknown as { barTicks: number; snapTick: (tick: number, snap?: number) => number; clampLocator: (tick: number, end: number) => number; eventTime: (straight: number, step: number, bpm: number, swing: number) => number; stepSeconds: (bpm: number) => number };
const i = instruments as unknown as { DRUM_PADS: PadInfo[]; PRESETS: { drums: KitInfo[] } };

export const { BEAT_LIMITS, createBeat, validateBeat, songEnd } = d;
export const { BeatRefusal, toggleStep, cycleVelocity, addHitToPattern, setTempo, rename, renameTrack, removeTrack, setTrackKit, setTrackMute, setTrackSolo, setTrackGain, setTrackPan, tryOp } = o;
export const { addRegion, moveRegion, copyRegion, resizeRegion, trimRegionStart, splitRegion, duplicateRegion, deleteRegion, setRegionPattern, selectPattern, setSwing, setSteps, copyPattern, clearPattern, setMetronome, setCycle, setView, setAudioRegion, addAudioRegion } = o;
export const { eventsAtStep, recordTarget } = e;
export const { eventTime, stepSeconds, snapTick, clampLocator, barTicks } = t;
export const DRUM_PADS: readonly PadInfo[] = i.DRUM_PADS;
export const DRUM_KITS: readonly KitInfo[] = i.PRESETS.drums;
export const STEP_TICKS = 240;
export const MIN_BPM = BEAT_LIMITS.bpm[0];
export const MAX_BPM = BEAT_LIMITS.bpm[1];
export const MAX_TRACKS = BEAT_LIMITS.tracks;
export const PATTERN_SLOTS = BEAT_LIMITS.patterns;
export const STEP_COUNTS = BEAT_LIMITS.steps;

/** Steps in one loop of the song (a default beat is four bars of sixteen). */
export const loopSteps = (doc: BeatDoc): number => Math.max(doc.steps, Math.round(songEnd(doc) / STEP_TICKS));

/** A drum track that sounds: the web `addTrack` makes an empty one, so give it a region as long as the loop. */
export function addKitTrack(doc: BeatDoc, kit = doc.tracks.find(track => !track.kind || track.kind === 'drums')?.kit ?? DRUM_KITS[0].id): BeatDoc {
    const length = Math.max(doc.steps * STEP_TICKS, songEnd(doc));
    const withTrack = o.addTrack(doc, kit);
    const track = withTrack.tracks[withTrack.tracks.length - 1];
    const withRegion = o.addRegion(withTrack, track.id, 0, doc.currentPattern);
    const region = withRegion.tracks[withRegion.tracks.length - 1].regions[0];
    return region.length === length ? withRegion : o.resizeRegion(withRegion, region.id, length);
}

export const hitsFor = (doc: BeatDoc, pad: PadId): readonly Hit[] => doc.patterns[doc.currentPattern]?.rows[pad] ?? [];
export const hasHit = (doc: BeatDoc, pad: PadId, step: number): boolean => hitsFor(doc, pad).some(([s]) => s === step);
/** True for any real hit in the slot, including steps 17-32 while a 16-step view hides them. */
export const patternHasHits = (doc: BeatDoc, slot: PatternSlot): boolean =>
    Object.values(doc.patterns[slot]?.rows ?? {}).some(hits => (hits?.length ?? 0) > 0);
export const kitLabel = (id?: string): string => DRUM_KITS.find(k => k.id === id)?.label ?? id ?? DRUM_KITS[0].label;
export const anySolo = (doc: BeatDoc): boolean => doc.tracks.some(track => track.solo);
/** Gain the strip should carry: mute and solo fold in, as the web song view does. */
export const audibleGain = (doc: BeatDoc, track: BeatTrackDoc): number => track.mute || (anySolo(doc) && !track.solo) ? 0 : track.gain;
