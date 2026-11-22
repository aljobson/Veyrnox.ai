import { File } from 'expo-file-system';
import {
    createEnergyAccumulator as createWebEnergyAccumulator,
    insertClipSegments as insertWebClipSegments,
    rankSegments as rankWebSegments,
    speechFromCaptions as speechFromWebCaptions,
} from '../../../../app/veyrnox/_lib/editorClipFinder.mjs';
import { editorMedia } from './editorMedia';
import {
    EDITOR_MEDIA_LIMITS,
    validateOwnedFileUri,
    validIdentifier,
    type EditorMediaError,
    type EditorMediaProgress,
    type EditorMediaResult,
    type PcmArtifact,
} from './editorMedia/protocol';
import { analyzeClipScenes, type SceneAnalysis, type SceneAnalysisInput } from './editorSceneAnalysis';
import type { Clip, Timeline } from './nativeEditorModel';

const FPS = 30;
const SAMPLE_RATE = 48_000;
const WINDOW_SECONDS = 0.5;
const MAX_CLIP_FRAMES = 900;
const MAX_PCM_SEGMENTS = 4_096;
const READ_BYTES = 64 * 1024;

export type ClipFinderPcmSegment = { offsetFrames: number; timestampUs: number; frames: number };
export type ClipFinderPcmArtifact = PcmArtifact & {
    channels: 1;
    mixMode: 'web-average';
    segments: ClipFinderPcmSegment[];
};
export type ClipFinderPcmRequest = {
    uri: string;
    fromSeconds: number;
    toSeconds: number;
    sampleRate: 48_000;
    channels: 1;
    mixMode: 'web-average';
};
export type ClipFinderPick = {
    start: number;
    end: number;
    score: number;
    parts: Record<string, number>;
    reasons: string[];
};
export type ClipFinderReasonCode = 'lively-audio' | 'speech-rich' | 'cut-aligned' | 'continuous-shot' | 'frequent-cuts' | 'good-length' | 'fallback';
export type ClipFinderRow = {
    id: string;
    rank: number;
    start: number;
    end: number;
    startFrame: number;
    endFrame: number;
    seconds: number;
    reasons: ClipFinderReasonCode[];
    ticked: boolean;
};
export type ClipFinderAnalysis = {
    picks: ClipFinderPick[];
    rows: ClipFinderRow[];
    hadAudio: boolean;
    cutCount: number;
    boundsSeconds: 30;
};
export type ClipFinderProgress = { phase: 'scenes' | 'audio'; value: number };
export type ClipFinderAnalysisInput = {
    project: string;
    uri: string;
    timeline: Timeline;
    clip: Pick<Clip, 'start' | 'in' | 'len'>;
    hasAudio: boolean;
    nominalFrameRate?: number;
    signal?: AbortSignal;
    onProgress?(progress: ClipFinderProgress): void;
};

type ClipFinderMedia = {
    decodePcm(project: string, request: ClipFinderPcmRequest, listener?: (progress: EditorMediaProgress) => void,
        signal?: AbortSignal): Promise<EditorMediaResult<ClipFinderPcmArtifact>>;
    release(project: string, artifactId: string): Promise<EditorMediaResult<null>>;
};
export type ClipFinderFiles = { chunks(uri: string): AsyncIterable<Uint8Array> };
export type ClipFinderSceneInput = SceneAnalysisInput & { samplingMode: 'all' };
export type ClipFinderAnalysisDependencies = {
    media?: ClipFinderMedia;
    files?: ClipFinderFiles;
    analyzeScenes?(input: ClipFinderSceneInput): Promise<EditorMediaResult<SceneAnalysis>>;
};

/** Narrow production seam so editor UI never imports the native media client directly. */
export async function clipFinderAnalysisAvailable(): Promise<boolean> {
    const capability = await editorMedia.capabilities();
    return capability.available && capability.operations.inspect && capability.operations.sampleFrames && capability.operations.decodePcm;
}

type WebEnergy = { windowSeconds: number; values: number[] };
type WebAccumulator = { add(timestamp: number, sampleRate: number, channels: readonly ArrayLike<number>[]): void; result(): WebEnergy };
type RelativeSpeech = { start: number; end: number; words: number };
type WebRank = (input: { duration: number; cuts: number[]; energy: WebEnergy | null; speech: RelativeSpeech[] }) => ClipFinderPick[];
type WebSpeech = (timeline: Timeline, clip: Pick<Clip, 'start' | 'in' | 'len'> & { in: number }) => RelativeSpeech[];
type WebInsertResult = Timeline | { error: string };
type WebInsert = (timeline: Timeline, mediaId: string, segments: readonly { start: number; end: number }[]) => WebInsertResult;

const createEnergyAccumulator = createWebEnergyAccumulator as (windowSeconds: number, from: number, to: number) => WebAccumulator;
const rankSegments = rankWebSegments as WebRank;
const speechFromCaptions = speechFromWebCaptions as WebSpeech;
const insertClipSegments = insertWebClipSegments as WebInsert;
const invalid: EditorMediaError = { ok: false, code: 'invalid-input' };
const cancelled: EditorMediaError = { ok: false, code: 'cancelled' };
const corrupt: EditorMediaError = { ok: false, code: 'corrupt-media' };
const failed: EditorMediaError = { ok: false, code: 'write-failed' };

class CorruptPcm extends Error {}

const safeInteger = (value: unknown): value is number => Number.isSafeInteger(value);
const positiveInteger = (value: unknown): value is number => safeInteger(value) && (value as number) > 0;
const nonNegativeInteger = (value: unknown): value is number => safeInteger(value) && (value as number) >= 0;
const stopped = (signal?: AbortSignal) => signal?.aborted === true;
const exactKeys = (value: object, keys: readonly string[]) => {
    const present = Object.keys(value);
    return present.length === keys.length && present.every(key => keys.includes(key));
};
const emit = (input: ClipFinderAnalysisInput, phase: ClipFinderProgress['phase'], value: number) => {
    try { input.onProgress?.({ phase, value: Math.min(1, Math.max(0, value)) }); } catch { /* UI progress never owns the analysis. */ }
};

const reasonCode = (reason: string): ClipFinderReasonCode => reason === 'Loud, lively audio' ? 'lively-audio'
    : reason.startsWith('Lots of speech (') ? 'speech-rich'
    : reason === 'Starts and ends on a cut' ? 'cut-aligned'
    : reason === 'One continuous shot' ? 'continuous-shot'
    : reason.startsWith('Cuts often (') ? 'frequent-cuts'
    : reason === 'A good length for a short clip' ? 'good-length'
    : 'fallback';

const defaultFiles: ClipFinderFiles = {
    chunks(uri) {
        return {
            async *[Symbol.asyncIterator]() {
                const handle = new File(uri).open();
                try {
                    for (;;) {
                        const chunk = await handle.readBytes(READ_BYTES);
                        if (!chunk.length) return;
                        yield chunk;
                    }
                } finally { handle.close(); }
            },
        };
    },
};

function validInput(input: ClipFinderAnalysisInput) {
    const start = input.clip.start, from = input.clip.in ?? 0, len = input.clip.len;
    return validIdentifier(input.project) && validateOwnedFileUri(input.uri) && typeof input.hasAudio === 'boolean'
        && nonNegativeInteger(start) && nonNegativeInteger(from) && positiveInteger(len) && len >= 3 && len <= MAX_CLIP_FRAMES
        && !!input.timeline && typeof input.timeline === 'object' && Array.isArray(input.timeline.text)
        && (input.nominalFrameRate === undefined || typeof input.nominalFrameRate === 'number' && Number.isFinite(input.nominalFrameRate)
            && input.nominalFrameRate > 0 && input.nominalFrameRate <= 240);
}

function validPcmArtifact(value: ClipFinderPcmArtifact) {
    if (!value || typeof value !== 'object' || value.kind !== 'pcm' || !validIdentifier(value.artifactId) || !validateOwnedFileUri(value.uri)
        || value.sampleRate !== SAMPLE_RATE || value.channels !== 1 || value.encoding !== 'f32le-interleaved' || value.mixMode !== 'web-average'
        || !positiveInteger(value.frames) || value.frames > SAMPLE_RATE * 30 || !positiveInteger(value.size)
        || value.size > EDITOR_MEDIA_LIMITS.pcmArtifactBytes || value.size !== value.frames * 4 || !Array.isArray(value.segments)
        || value.segments.length < 1 || value.segments.length > MAX_PCM_SEGMENTS) return false;
    let offset = 0, previousTimestamp = -1;
    for (const segment of value.segments) {
        if (!segment || typeof segment !== 'object' || !exactKeys(segment, ['offsetFrames', 'timestampUs', 'frames'])
            || segment.offsetFrames !== offset || !nonNegativeInteger(segment.timestampUs) || segment.timestampUs <= previousTimestamp
            || !positiveInteger(segment.frames)) return false;
        offset += segment.frames;
        if (!Number.isSafeInteger(offset) || offset > value.frames) return false;
        previousTimestamp = segment.timestampUs;
    }
    return offset === value.frames;
}

async function energyFromPcm(artifact: ClipFinderPcmArtifact, from: number, to: number, files: ClipFinderFiles,
    signal: AbortSignal | undefined, onRead: (value: number) => void): Promise<WebEnergy> {
    if (!validPcmArtifact(artifact)) throw new CorruptPcm();
    const accumulator = createEnergyAccumulator(WINDOW_SECONDS, from, to);
    let totalBytes = 0, frame = 0, segmentIndex = 0, inSegment = 0;
    let pending = new Uint8Array(0);
    for await (const raw of files.chunks(artifact.uri)) {
        if (stopped(signal)) throw cancelled;
        if (!(raw instanceof Uint8Array)) throw new CorruptPcm();
        totalBytes += raw.byteLength;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > artifact.size) throw new CorruptPcm();
        let bytes = raw;
        if (pending.byteLength) {
            bytes = new Uint8Array(pending.byteLength + raw.byteLength);
            bytes.set(pending); bytes.set(raw, pending.byteLength);
        }
        const complete = bytes.byteLength - bytes.byteLength % 4;
        const view = new DataView(bytes.buffer, bytes.byteOffset, complete);
        let sampleOffset = 0;
        while (sampleOffset < complete / 4) {
            if (stopped(signal)) throw cancelled;
            const segment = artifact.segments[segmentIndex];
            if (!segment || frame !== segment.offsetFrames + inSegment) throw new CorruptPcm();
            const take = Math.min(complete / 4 - sampleOffset, segment.frames - inSegment);
            if (take <= 0) throw new CorruptPcm();
            const samples = new Float32Array(take);
            for (let index = 0; index < take; index++) {
                if ((index & 4_095) === 0 && stopped(signal)) throw cancelled;
                const sample = view.getFloat32((sampleOffset + index) * 4, true);
                if (!Number.isFinite(sample)) throw new CorruptPcm();
                samples[index] = sample;
            }
            accumulator.add(segment.timestampUs / 1_000_000 + inSegment / SAMPLE_RATE, SAMPLE_RATE, [samples]);
            frame += take; inSegment += take; sampleOffset += take;
            if (inSegment === segment.frames) { segmentIndex++; inSegment = 0; }
        }
        pending = bytes.slice(complete);
        onRead(frame / artifact.frames);
    }
    if (stopped(signal)) throw cancelled;
    if (pending.byteLength || totalBytes !== artifact.size || frame !== artifact.frames || segmentIndex !== artifact.segments.length || inSegment !== 0) throw new CorruptPcm();
    return accumulator.result();
}

/** Exact mobile equivalent of the web pick-row adapter. Picks remain score ordered; only insertion is source ordered. */
export function clipFinderRows(clip: Pick<Clip, 'start' | 'in' | 'len'>, picks: readonly ClipFinderPick[], tickedCount = 3): ClipFinderRow[] {
    const from = clip.in ?? 0, rows: ClipFinderRow[] = [];
    for (const pick of picks) {
        const sourceStartFrame = Math.round(pick.start * FPS), sourceEndFrame = Math.round(pick.end * FPS);
        if (sourceStartFrame < from || sourceEndFrame > from + clip.len || sourceEndFrame <= sourceStartFrame) continue;
        const rank = rows.length + 1, startFrame = clip.start + sourceStartFrame - from, endFrame = clip.start + sourceEndFrame - from;
        rows.push({ id: `clip-pick-${sourceStartFrame}-${sourceEndFrame}`, rank, start: pick.start, end: pick.end, startFrame, endFrame,
            seconds: pick.end - pick.start, reasons: pick.reasons.map(reasonCode), ticked: rank <= tickedCount });
    }
    return rows;
}

export const selectedClipFinderSegments = (rows: readonly ClipFinderRow[]) => rows.filter(row => row.ticked).map(({ start, end }) => ({ start, end }));

/** Pure, immutable and all-or-nothing: the caller commits the returned timeline once, or displays its error. */
export function appendSelectedClipFinderRows(timeline: Timeline, mediaId: string, rows: readonly ClipFinderRow[]): WebInsertResult {
    return insertClipSegments(timeline, mediaId, selectedClipFinderSegments(rows));
}

/**
 * Runs the public native operations sequentially because the editor-media bridge admits one lease at a time. Ranking and reasons come
 * directly from the canonical web evaluator; this adapter only validates native PCM and maps source/timeline coordinates.
 */
export async function analyzeClipForFinder(input: ClipFinderAnalysisInput,
    dependencies: ClipFinderAnalysisDependencies = {}): Promise<EditorMediaResult<ClipFinderAnalysis>> {
    if (!validInput(input)) return invalid;
    if (stopped(input.signal)) return cancelled;
    const media = dependencies.media ?? editorMedia as unknown as ClipFinderMedia;
    const files = dependencies.files ?? defaultFiles;
    const sceneAnalyzer = dependencies.analyzeScenes ?? analyzeClipScenes as unknown as NonNullable<ClipFinderAnalysisDependencies['analyzeScenes']>;
    const sourceIn = input.clip.in ?? 0, from = sourceIn / FPS, duration = input.clip.len / FPS, to = from + duration;
    const normalizedClip = { ...input.clip, in: sourceIn };
    let artifact: ClipFinderPcmArtifact | undefined;
    try {
        let scenes: EditorMediaResult<SceneAnalysis>;
        try {
            scenes = await sceneAnalyzer({ project: input.project, uri: input.uri, clip: normalizedClip, samplingMode: 'all', nominalFrameRate: input.nominalFrameRate, signal: input.signal,
                onProgress: progress => emit(input, 'scenes', progress.value) });
        } catch { return stopped(input.signal) ? cancelled : failed; }
        if (!scenes.ok) return scenes;
        if (stopped(input.signal)) return cancelled;

        let energy: WebEnergy | null = null;
        if (input.hasAudio) {
            let decoded: EditorMediaResult<ClipFinderPcmArtifact>;
            const request: ClipFinderPcmRequest = { uri: input.uri, fromSeconds: from, toSeconds: to, sampleRate: SAMPLE_RATE, channels: 1, mixMode: 'web-average' };
            try { decoded = await media.decodePcm(input.project, request, progress => emit(input, 'audio', progress.value), input.signal); }
            catch { return stopped(input.signal) ? cancelled : failed; }
            if (!decoded.ok) return decoded;
            artifact = decoded.value;
            if (stopped(input.signal)) return cancelled;
            try { energy = await energyFromPcm(artifact, from, to, files, input.signal, value => emit(input, 'audio', value)); }
            catch (error) { return stopped(input.signal) || error === cancelled ? cancelled : corrupt; }
        }
        if (stopped(input.signal)) return cancelled;
        const cuts = scenes.value.cuts.filter(cut => cut.kind === 'hard').map(cut => cut.time - from).filter(time => time > 0 && time < duration);
        const speech = speechFromCaptions(input.timeline, normalizedClip).map(entry => ({ ...entry, start: entry.start - from, end: entry.end - from }));
        const picks = rankSegments({ duration, cuts, energy, speech }).map(pick => ({ ...pick, start: pick.start + from, end: pick.end + from }));
        if (stopped(input.signal)) return cancelled;
        return { ok: true, value: { picks, rows: clipFinderRows(normalizedClip, picks), hadAudio: input.hasAudio, cutCount: cuts.length, boundsSeconds: 30 } };
    } catch { return stopped(input.signal) ? cancelled : corrupt; }
    finally {
        if (artifact) { try { await media.release(input.project, artifact.artifactId); } catch { /* Acquired PCM cleanup is best effort. */ } }
    }
}
