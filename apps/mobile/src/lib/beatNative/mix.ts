// Typed seams only: these exports are the web functions themselves.
// @ts-ignore shared JavaScript module
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
// @ts-ignore shared JavaScript module
import * as rules from '../../../../../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
// @ts-ignore shared JavaScript module
import * as controls from '../../../../../app/veyrnox/_lib/music/beat/beatMixControls.mjs';
// @ts-ignore shared JavaScript module
import * as automation from '../../../../../app/veyrnox/_lib/music/beat/beatAutomation.mjs';
// @ts-ignore shared JavaScript module
import * as graph from '../../../../../app/veyrnox/_lib/music/beat/beatMixGraph.js';
import type { BeatDoc, BeatTrackDoc, Edit } from './doc';

export type FxType = 'eq' | 'compressor' | 'distortion' | 'delay' | 'reverb';
export type Effect = { id: string; type: FxType; bypass: boolean; params: Record<string, number> };
export type MixMaster = { gain: number; limiter: boolean; reverb: { size: number }; delay: { time: number; feedback: number } };
export type MasterPatch = Partial<Omit<MixMaster, 'reverb' | 'delay'>> & { reverb?: Partial<MixMaster['reverb']>; delay?: Partial<MixMaster['delay']> };
export type Sends = { reverb: number; delay: number };
export type Lane = 'gain' | 'pan';
export type AutomationPoint = [tick: number, value: number, curve: number];
export type MixTrack = BeatTrackDoc & { fx?: Effect[]; sends?: Sends; automation?: Partial<Record<Lane, AutomationPoint[]>> };
export type MixDoc = BeatDoc & { tracks: MixTrack[]; view: 'song' | 'pattern'; master?: MixMaster };
export type MixApply = (operation: Edit, announce?: string, key?: string) => boolean;

export const { addEffect, removeEffect, moveEffect, setEffectBypass, setEffectParam, setSend, setMaster,
    addAutomationPoint, moveAutomationPoint, setAutomationCurve, clearAutomation, removeAutomationPoint } = ops as {
    addEffect(d: BeatDoc, id: string, type: FxType): MixDoc;
    removeEffect(d: BeatDoc, id: string, fx: string): MixDoc;
    moveEffect(d: BeatDoc, id: string, fx: string, delta: -1 | 1): MixDoc;
    setEffectBypass(d: BeatDoc, id: string, fx: string, bypass: boolean): MixDoc;
    setEffectParam(d: BeatDoc, id: string, fx: string, param: string, value: number): MixDoc;
    setSend(d: BeatDoc, id: string, bus: keyof Sends, value: number): MixDoc;
    setMaster(d: BeatDoc, patch: MasterPatch): MixDoc;
    addAutomationPoint(d: BeatDoc, id: string, lane: Lane, tick: number, value: number): MixDoc;
    moveAutomationPoint(d: BeatDoc, id: string, lane: Lane, index: number, tick: number, value: number): MixDoc;
    setAutomationCurve(d: BeatDoc, id: string, lane: Lane, index: number, curve: number): MixDoc;
    clearAutomation(d: BeatDoc, id: string, lane: Lane): MixDoc;
    removeAutomationPoint(d: BeatDoc, id: string, lane: Lane, index: number): MixDoc;
};
export const { REVERB_SIZES, DEFAULT_FX_PARAMS, DEFAULT_MASTER, FX_RANGES, trackHasMix, hasMixer } = rules as unknown as {
    REVERB_SIZES: readonly number[]; DEFAULT_FX_PARAMS: Readonly<Record<FxType, Readonly<Record<string, number>>>>;
    DEFAULT_MASTER: MixMaster; FX_RANGES: Readonly<Record<string, readonly [number, number]>>;
    trackHasMix(t: MixTrack): boolean; hasMixer(d: BeatDoc): boolean;
};
export const { effectParamLive, sendLevelLive, masterPatchLive, automationControl } = controls as {
    effectParamLive(param: string): boolean; sendLevelLive(t: MixTrack, bus: keyof Sends, value: number): boolean;
    masterPatchLive(d: BeatDoc, patch: MasterPatch): boolean;
    automationControl(t: MixTrack, lane: Lane, view: MixDoc['view'], recording?: boolean): { disabled: boolean; message: string };
};
export const { automationEnvelope, envelopeAt } = automation as unknown as {
    automationEnvelope(points: AutomationPoint[], bpm: number): [number, number][];
    envelopeAt(envelope: [number, number][], sec: number): number;
};
export const { mixSignature } = graph as { mixSignature(d: BeatDoc): string };
// Envelopes capture tempo/view at construction. G2 also needs a fresh, single-write shaper.
export const runKey = (doc: BeatDoc): string => JSON.stringify([mixSignature(doc), doc.tempo.bpm, (doc as MixDoc).view,
    doc.tracks.map(t => (t as MixTrack).fx?.filter(f => f.type === 'distortion').map(f => f.params.drive))]);
export const nativeMixSignature = runKey;
