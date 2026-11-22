import { File } from 'expo-file-system';
import { detectScenes as detectWebScenes, frameSignature as webFrameSignature } from '../../../../app/veyrnox/_lib/editorSceneDetect.mjs';
import { editorMedia } from './editorMedia';
import { validateOwnedFileUri, validIdentifier, type EditorMediaError, type EditorMediaProgress, type EditorMediaResult, type FrameArtifact,
    type SampleFramesRequest } from './editorMedia/protocol';

const FPS = 30;
const WIDTH = 128;
const HEIGHT = 72;
const STRIDE = 512;
const FRAME_BYTES = 36_864;
const MAX_FRAMES = 900;
const MANIFEST_NAME = 'frames.json';
const MANIFEST_KEYS = ['version', 'format', 'width', 'height', 'rowStride', 'colorSpace', 'orientedWidth', 'orientedHeight', 'transform', 'resizeMode', 'frames'] as const;
const FRAME_KEYS = ['file', 'timestampUs'] as const;
const FRAME_NAME = /^frame-(\d{6})\.rgba$/;

export type SceneSignature = { hist: Float32Array; edges: Uint16Array };
export type SceneCut = { time: number; score: number; kind: 'hard' | 'gradual' };
export type SceneClipRange = { start: number; in: number; len: number };
export type SceneRow = { frame: number; time: number; kind: 'hard' | 'possible'; ticked: boolean };
export type SceneAnalysis = { cuts: SceneCut[]; rows: SceneRow[]; frames: number; sampledFrames: number };
export type SceneAnalysisInput = {
    project: string;
    uri: string;
    clip: SceneClipRange;
    samplingMode?: 'all';
    nominalFrameRate?: number;
    signal?: AbortSignal;
    onProgress?(progress: EditorMediaProgress): void;
};

type SceneMedia = Pick<typeof editorMedia, 'sampleFrames' | 'release'>;
export type SceneAnalysisFiles = { text(uri: string): Promise<string>; bytes(uri: string): Promise<Uint8Array> };
export type SceneAnalysisDependencies = { media?: SceneMedia; files?: SceneAnalysisFiles };

/** Narrow production seam so editor UI never gains access to the native probe or encode surface. */
export async function sceneAnalysisAvailable(): Promise<boolean> {
    const capability = await editorMedia.capabilities();
    return capability.available && capability.operations.inspect && capability.operations.sampleFrames;
}

export async function inspectSceneAnalysisSource(project: string, uri: string, signal?: AbortSignal) {
    await editorMedia.bumpProjectGeneration(project);
    if (signal?.aborted) return cancelled;
    return editorMedia.inspect(project, uri, undefined, signal);
}

type ManifestFrame = { file: string; timestampUs: number };
type FrameManifest = {
    version: 1;
    format: 'rgba8';
    width: 128;
    height: 72;
    rowStride: 512;
    colorSpace: 'srgb';
    orientedWidth: number;
    orientedHeight: number;
    transform: number[];
    resizeMode: 'fill';
    samplingMode?: 'all';
    maximumFrameRate?: 60;
    frames: ManifestFrame[];
};
type WebDetector = (samples: readonly { time: number; signature: SceneSignature }[]) => { cuts: SceneCut[]; frames: number };
type WebSignature = (pixels: Uint8ClampedArray, width: number, height: number) => SceneSignature;

const detectScenes = detectWebScenes as WebDetector;
const frameSignature = webFrameSignature as WebSignature;
const invalid: EditorMediaError = { ok: false, code: 'invalid-input' };
const cancelled: EditorMediaError = { ok: false, code: 'cancelled' };
const corrupt: EditorMediaError = { ok: false, code: 'corrupt-media' };
const failed: EditorMediaError = { ok: false, code: 'write-failed' };
const defaultFiles: SceneAnalysisFiles = {
    text: uri => new File(uri).text(),
    bytes: uri => new File(uri).bytes(),
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const safePositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const safeNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const sameNumbers = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index]);
const stopped = (signal?: AbortSignal) => signal?.aborted === true;

function validInput(input: SceneAnalysisInput) {
    const { clip } = input;
    return validIdentifier(input.project) && validateOwnedFileUri(input.uri) && safeNonNegativeInteger(clip.start) && safeNonNegativeInteger(clip.in)
        && safePositiveInteger(clip.len) && clip.len >= 3 && clip.len <= MAX_FRAMES
        && (input.nominalFrameRate === undefined || finite(input.nominalFrameRate) && input.nominalFrameRate > 0 && input.nominalFrameRate <= 240);
}

export function exactSceneFrameBudget(clipFrames: number, nominalFrameRate?: number) {
    const duration = clipFrames / FPS, sourceRate = nominalFrameRate && nominalFrameRate > 0 ? nominalFrameRate : 60;
    return Math.min(1_800, Math.ceil(duration * Math.min(60, sourceRate)) + 2);
}

function childUri(manifestUri: string, name: string): string | null {
    if (!validateOwnedFileUri(manifestUri) || !manifestUri.endsWith(`/${MANIFEST_NAME}`) || !FRAME_NAME.test(name)) return null;
    const directory = manifestUri.slice(0, -MANIFEST_NAME.length);
    const candidate = `${directory}${name}`;
    if (!validateOwnedFileUri(candidate) || !candidate.startsWith(directory) || candidate.slice(directory.length) !== name) return null;
    return candidate;
}

function parseManifest(raw: string, artifact: FrameArtifact, request: SampleFramesRequest): FrameManifest | null {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    const keys = request.samplingMode === 'all' ? [...MANIFEST_KEYS, 'samplingMode', 'maximumFrameRate'] : MANIFEST_KEYS;
    if (!object(value) || !exact(value, keys) || value.version !== 1 || value.format !== 'rgba8' || value.width !== WIDTH || value.height !== HEIGHT
        || value.rowStride !== STRIDE || value.colorSpace !== 'srgb' || value.resizeMode !== 'fill' || !safePositiveInteger(value.orientedWidth)
        || !safePositiveInteger(value.orientedHeight) || !Array.isArray(value.transform) || value.transform.length !== 6 || !value.transform.every(finite)
        || !Array.isArray(value.frames) || value.frames.length !== artifact.count || value.frames.length < 1 || value.frames.length > request.maxFrames
        || artifact.timestampsUs.length !== value.frames.length || !sameNumbers(value.transform as number[], artifact.preferredTransform)
        || (request.samplingMode === 'all' ? value.samplingMode !== 'all' || value.maximumFrameRate !== request.maximumFrameRate
            : value.samplingMode !== undefined || value.maximumFrameRate !== undefined)) return null;
    const fromUs = Math.round(request.fromSeconds * 1_000_000), toUs = Math.round(request.toSeconds * 1_000_000);
    let previous = -1;
    const frames: ManifestFrame[] = [];
    for (let index = 0; index < value.frames.length; index++) {
        const record = value.frames[index];
        if (!object(record) || !exact(record, FRAME_KEYS) || typeof record.file !== 'string' || !safeNonNegativeInteger(record.timestampUs)
            || record.file !== `frame-${String(index).padStart(6, '0')}.rgba` || record.timestampUs !== artifact.timestampsUs[index]
            || record.timestampUs <= previous || record.timestampUs < fromUs || record.timestampUs > toUs || !childUri(artifact.uri, record.file)) return null;
        previous = record.timestampUs;
        frames.push({ file: record.file, timestampUs: record.timestampUs });
    }
    return { version: 1, format: 'rgba8', width: WIDTH, height: HEIGHT, rowStride: STRIDE, colorSpace: 'srgb', orientedWidth: value.orientedWidth,
        orientedHeight: value.orientedHeight, transform: value.transform as number[], resizeMode: 'fill',
        ...(request.samplingMode === 'all' ? { samplingMode: 'all' as const, maximumFrameRate: 60 as const } : {}), frames };
}

function validArtifact(value: FrameArtifact, request: SampleFramesRequest) {
    return value.kind === 'frames' && validIdentifier(value.artifactId) && validateOwnedFileUri(value.uri) && value.uri.endsWith(`/${MANIFEST_NAME}`)
        && value.width === WIDTH && value.height === HEIGHT && value.stride === STRIDE && value.pixelFormat === 'rgba8' && value.colorSpace === 'srgb'
        && value.resizeMode === 'fill' && safePositiveInteger(value.count) && value.count <= request.maxFrames && Array.isArray(value.timestampsUs)
        && value.timestampsUs.length === value.count && Array.isArray(value.preferredTransform) && value.preferredTransform.length === 6
        && value.preferredTransform.every(finite) && (value.samplingMode ?? 'uniform') === (request.samplingMode ?? 'uniform')
        && (request.samplingMode === 'all' ? value.maximumFrameRate === request.maximumFrameRate : value.maximumFrameRate === undefined);
}

export function sceneRowsForClip(clip: SceneClipRange, cuts: readonly SceneCut[]): SceneRow[] {
    const rows: SceneRow[] = [];
    for (const cut of cuts) {
        const offset = Math.round(cut.time * FPS) - clip.in;
        if (offset < 1 || offset > clip.len - 1) continue;
        const frame = clip.start + offset;
        if (rows.some(row => row.frame === frame)) continue;
        rows.push({ frame, time: cut.time, kind: cut.kind === 'hard' ? 'hard' : 'possible', ticked: cut.kind === 'hard' });
    }
    return rows.sort((left, right) => left.frame - right.frame);
}

export async function analyzeClipScenes(input: SceneAnalysisInput, dependencies: SceneAnalysisDependencies = {}): Promise<EditorMediaResult<SceneAnalysis>> {
    if (!validInput(input)) return invalid;
    if (stopped(input.signal)) return cancelled;
    const media = dependencies.media ?? editorMedia;
    const files = dependencies.files ?? defaultFiles;
    const request: SampleFramesRequest = { uri: input.uri, fromSeconds: input.clip.in / FPS, toSeconds: (input.clip.in + input.clip.len) / FPS,
        maxFrames: input.samplingMode === 'all' ? exactSceneFrameBudget(input.clip.len, input.nominalFrameRate) : input.clip.len, resizeMode: 'fill',
        ...(input.samplingMode === 'all' ? { samplingMode: 'all' as const, maximumFrameRate: 60 as const } : {}) };
    let artifact: FrameArtifact | undefined;
    try {
        let sampled: EditorMediaResult<FrameArtifact>;
        try { sampled = await media.sampleFrames(input.project, request, input.onProgress, input.signal); }
        catch { return stopped(input.signal) ? cancelled : failed; }
        if (!sampled.ok) return sampled;
        artifact = sampled.value;
        if (stopped(input.signal)) return cancelled;
        if (!validArtifact(artifact, request)) return corrupt;
        let manifest: FrameManifest | null;
        try { manifest = parseManifest(await files.text(artifact.uri), artifact, request); }
        catch { return stopped(input.signal) ? cancelled : corrupt; }
        if (stopped(input.signal)) return cancelled;
        if (!manifest) return corrupt;
        const samples: { time: number; signature: SceneSignature }[] = [];
        for (const record of manifest.frames) {
            if (stopped(input.signal)) return cancelled;
            const uri = childUri(artifact.uri, record.file); if (!uri) return corrupt;
            let bytes: Uint8Array;
            try { bytes = await files.bytes(uri); } catch { return stopped(input.signal) ? cancelled : corrupt; }
            if (stopped(input.signal)) return cancelled;
            if (!(bytes instanceof Uint8Array) || bytes.byteLength !== FRAME_BYTES) return corrupt;
            const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            samples.push({ time: record.timestampUs / 1_000_000, signature: frameSignature(pixels, WIDTH, HEIGHT) });
        }
        if (stopped(input.signal)) return cancelled;
        const detected = detectScenes(samples);
        if (!Number.isSafeInteger(detected.frames) || detected.frames < 0 || !Array.isArray(detected.cuts)) return corrupt;
        if (stopped(input.signal)) return cancelled;
        return { ok: true, value: { cuts: detected.cuts, rows: sceneRowsForClip(input.clip, detected.cuts), frames: detected.frames, sampledFrames: artifact.count } };
    } catch { return stopped(input.signal) ? cancelled : corrupt; }
    finally {
        if (artifact) { try { await media.release(input.project, artifact.artifactId); } catch { /* Artifact cleanup is best effort and never changes the analysis result. */ } }
    }
}
