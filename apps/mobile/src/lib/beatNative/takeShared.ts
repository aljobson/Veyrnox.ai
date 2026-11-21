// Typed boundary only: document/session/storage rules remain owned by the web editor.
// Browser capture and IndexedDB are imported transitively but are never invoked here.
import './takeRuntime';
import { createTakeFiles, eraseAccountTakes, nativeTakeIO, noAccountTakeIO } from './takeFiles';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import type { BeatDoc, Edit } from './doc';
import type { EngineContext } from './shared';
// @ts-ignore shared JavaScript, signatures below are the native boundary
import * as session from '../../../../../app/veyrnox/_lib/music/beat/beatAudioRecordingSession.js';
// @ts-ignore shared JavaScript
import * as ops from '../../../../../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
// @ts-ignore shared JavaScript
import * as capture from '../../../../../app/veyrnox/_lib/music/beat/beatTakeCapture.mjs';
// @ts-ignore shared JavaScript
import * as latency from '../../../../../app/veyrnox/_lib/music/beat/beatLatency.mjs';
// @ts-ignore shared JavaScript
import * as storage from '../../../../../app/veyrnox/_lib/music/beat/beatTakeStore.js';
// @ts-ignore shared JavaScript
import * as segments from '../../../../../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
// @ts-ignore shared JavaScript
import * as cloud from '../../../../../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
// @ts-ignore shared JavaScript
import * as compat from '../../../../../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
// @ts-ignore shared JavaScript
import * as beatOps from '../../../../../app/veyrnox/_lib/music/beat/beatOps.mjs';

export type TakeAsset = { source: 'take'; ref: string; name: string; durationSec: number; bpm: null; sourceChannels: number; encodedBytes: number };
export type TakeGroup = { id: string; start: number; length: number; lanes: string[]; comp: [number, number][]; xfadeMs: number };
export type TakeRow = { id: string; beatId: string; label: string; sampleRate: number; length: number; createdAt: number; state: 'pending' | 'committed' | 'discarded'; samples?: Float32Array; pending?: { beatId: string; trackId: string; start: number; length: number; pass: number; recordingId: string; cycle: boolean } };
export type AudioTake = TakeRow & { samples: Float32Array };
export type TakeChunk = AudioTake & { takeId: string; offset: number };
export type CaptureChunk = { frame: number; samples: Float32Array };
export type Capture = { context: EngineContext; deviceId: string; readonly ended: boolean; readonly capturedFrame?: number; subscribe(fn: (chunk: CaptureChunk) => void): () => void; close(): void | Promise<void> };
export type SongWindow = { fromSec: number; toSec: number; contextTime: number };
export type RecordingRange = { start: number; length: number; cycle: boolean; maxSeconds?: number };
export type RecordingState = { status: 'idle' | 'opening' | 'armed' | 'recording' | 'finishing' | 'error'; seconds: number; pass: number; error: string };
export type RecordingEdit = (edit: Edit, options?: { recordingCommit?: boolean; label?: string; message?: string }) => boolean;
export type Session = { readonly error: string; readonly finishing: boolean; window(w: SongWindow): void; finish(): Promise<BeatDoc>; retry(): Promise<BeatDoc>; discard(): Promise<BeatDoc> };
export type SyncStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export type BeatTakeStorage = { listState(): Promise<TakeRow[]>; putState(row: TakeRow, check?: () => void): Promise<boolean>; get(id: string): Promise<AudioTake | null>; put(row: AudioTake, check?: () => void): Promise<boolean>; listChunksFor(id: string): Promise<TakeChunk[]>; putChunk(row: TakeChunk, check?: () => void): Promise<boolean> };
export const { createAudioRecording, audioRecordingRange, takeAsset, recordingDurationLimit } = session as {
    createAudioRecording(options: { doc: BeatDoc; trackId: string; range: RecordingRange; capture: Capture; rtt: number; contextStart: number; countIn: boolean; current(): BeatDoc; edit: RecordingEdit; announce(message: string): void; onState(state: Partial<RecordingState>): void; stop(): unknown; onSettled?(): void; drain(c: Capture, end: number, rtt: number): Promise<boolean>; t(key: string, params?: Record<string, string | number>): string }): Session;
    audioRecordingRange(doc: BeatDoc, locator: number): RecordingRange;
    takeAsset(row: TakeRow): TakeAsset;
    recordingDurationLimit(range: RecordingRange, bpm: number, sr: number, passes: number): { seconds: number; cloud: boolean; passes: boolean };
};
export const { commitRecording, recordingCapacity, setComp, useWholeTake, setCrossfade, flattenGroup, deleteLane } = ops as {
    commitRecording(doc: BeatDoc, options: { trackId: string; start: number; length: number; single?: boolean; takes: { asset: TakeAsset }[] }): BeatDoc;
    recordingCapacity(doc: BeatDoc, trackId: string, options: { start: number; length: number; single?: boolean; preflight?: boolean }): { lanes: number; reason?: string };
    setComp(doc: BeatDoc, trackId: string, groupId: string, from: number, to: number, lane: number): BeatDoc;
    useWholeTake(doc: BeatDoc, trackId: string, groupId: string, lane: number): BeatDoc;
    setCrossfade(doc: BeatDoc, trackId: string, groupId: string, ms: number): BeatDoc;
    flattenGroup(doc: BeatDoc, trackId: string, groupId: string): BeatDoc;
    deleteLane(doc: BeatDoc, trackId: string, groupId: string, lane: number): BeatDoc;
};
export const { splitPasses, capturedSamples } = capture as {
    splitPasses(chunks: CaptureChunk[], windows: SongWindow[], options: { sr: number; rtt?: number; groupStartSec: number; groupEndSec: number; cycle?: boolean; endContextTime?: number; maxPasses?: number; compact?: boolean }): { pass: number; complete: boolean; offset: number; samples: Float32Array }[];
    capturedSamples(chunks: CaptureChunk[], start: number, end: number): Float32Array;
};
export const { calibrationFrames, detectClickOnsets, matchCalibration, readLatency, writeLatency } = latency as {
    calibrationFrames(sr: number, start?: number): number[];
    detectClickOnsets(samples: Float32Array, sr: number, first?: number): { frame: number; peak: number }[];
    matchCalibration(onsets: { frame: number; peak: number }[], frames: number[], sr: number): { ok: boolean; ms?: number; error?: string };
    readLatency(device: string, storage: SyncStorage, now?: number): { ms: number; measuredAt: number } | null;
    writeLatency(device: string, ms: number, storage: SyncStorage, now?: number): boolean;
};
const { loadBeatTake: loadShared, putBeatTake: putShared, appendBeatTake: appendShared, reconcileBeatTakes: reconcileShared, discardBeatTakes: discardShared } = storage as unknown as {
    loadBeatTake(id: string): Promise<AudioTake | null>;
    putBeatTake(row: AudioTake, check?: () => void): Promise<AudioTake>;
    appendBeatTake(row: AudioTake, offset: number, check?: () => void): Promise<AudioTake>;
    reconcileBeatTakes(doc: BeatDoc): Promise<void>;
    discardBeatTakes(ids: string[]): Promise<void>;
};
export const { configureBeatTakeStorage, hydrateBeatTakes, pendingBeatTakes, documentHasTake, beatTakeBytes, BEAT_TAKE_BYTES, subscribeBeatTakes } = storage as unknown as {
    configureBeatTakeStorage(adapter: BeatTakeStorage): void;
    hydrateBeatTakes(): Promise<void>;
    pendingBeatTakes(id: string): TakeRow[];
    documentHasTake(doc: BeatDoc, row: TakeRow): boolean;
    beatTakeBytes(): number; BEAT_TAKE_BYTES: number;
    subscribeBeatTakes(listener: () => void): () => void;
};
export type AudioPiece = { trackId: string; assetId: string; songTimeSec: number; offsetSec: number; durationSec: number; reverse: boolean; gain: number; endGain: number };
export const { audioPieces, songWindowToContext, tickSeconds } = segments as {
    audioPieces(doc: BeatDoc, from: number, to: number, options?: { startSec?: number; endSec?: number }): AudioPiece[];
    songWindowToContext(from: number, to: number, options: { startSec: number; contextStart: number; cycle: { start: number; end: number } | null; endSec: number }): SongWindow[];
    tickSeconds(ticks: number, bpm: number): number;
};
export type CloudTake = { id: string; take_ref: string; status: 'pending' | 'ready'; byte_size?: number; duration_sec?: number };
export type Reservation = { take_id: string; status: 'pending' | 'ready'; upload_url: string; upload_headers: Record<string, string> };
export const { recoverTake, takeAssets } = cloud as {
    recoverTake(options: { row?: CloudTake; confirm(id: string): Promise<unknown>; reserve(): Promise<Reservation>; put(row: Reservation): Promise<{ ok: boolean; status: number }> }): Promise<{ id: string; status: string }>;
    takeAssets(doc: BeatDoc): TakeAsset[];
};
export const { beatReadOnly, assertBeatWritable } = compat as { beatReadOnly(doc?: BeatDoc): boolean; assertBeatWritable(doc: BeatDoc): void };
export const addAudioTrack = beatOps.addAudioTrack as (doc: BeatDoc) => BeatDoc;

// The shared store has one storage slot and finishes queued work against whatever is installed, so every
// call is fenced to the account it started under. Its memory is rebuilt once the old account's work has settled.
let configured = false;
let takeOwner: string | null = null;
const inFlight = new Set<Promise<unknown>>();
const tracked = <T>(work: Promise<T>) => {
    inFlight.add(work);
    const done = () => { inFlight.delete(work); };
    work.then(done, done);
    return work;
};
const fenced = (check?: () => void) => {
    const owner = takeOwner;
    return () => { if (owner !== takeOwner) throw new Error('account_changed'); check?.(); };
};
const installTakes = (owner: string | null) => {
    configureBeatTakeStorage(owner ? createTakeFiles(nativeTakeIO(owner), owner) : createTakeFiles(noAccountTakeIO));
};
function switchTakeOwner(next: string | null) {
    if (next === takeOwner) return;
    takeOwner = next;
    installTakes(next);
    const stale = [...inFlight];
    if (stale.length) void Promise.allSettled(stale).then(() => { if (takeOwner === next) installTakes(next); });
}
export const putBeatTake = (row: AudioTake, check?: () => void) => tracked(putShared(row, fenced(check)));
export const appendBeatTake = (row: AudioTake, offset: number, check?: () => void) => tracked(appendShared(row, offset, fenced(check)));
export const reconcileBeatTakes = (doc: BeatDoc) => tracked(reconcileShared(doc));
export const discardBeatTakes = (ids: string[]) => tracked(discardShared(ids));
export async function loadBeatTake(id: string): Promise<AudioTake | null> {
    const owner = takeOwner, row = await tracked(loadShared(id));
    return owner === takeOwner ? row : null;
}
/** Account deletion only: nothing may be writing when the folder goes. */
export async function eraseBeatTakes(owner: string) {
    if (takeOwner === owner) switchTakeOwner(null);
    await Promise.allSettled([...inFlight]);
    eraseAccountTakes(owner);
}
export function configureNativeTakeStorage() {
    if (configured) return;
    configured = true;
    takeOwner = getCacheUser() ?? null;
    installTakes(takeOwner);
    subscribeCacheUser(user => switchTakeOwner(user ?? null));
}
// Synchronous installation only: no disk IO until a caller actually reads/writes a take.
// Child effects may run before the editor's effects, so effect-time configuration is too late.
configureNativeTakeStorage();
