export const EDITOR_MEDIA_PROTOCOL_VERSION = 1 as const;
export const EDITOR_MEDIA_LIMITS = Object.freeze({
    durationSeconds: 30, sourceWidth: 1280, sourceHeight: 720, analysisWidth: 128, analysisHeight: 72,
    batchFrames: 8, batchBytes: 32 * 1024 * 1024, frameArtifactBytes: 64 * 1024 * 1024,
    pcmArtifactBytes: 16 * 1024 * 1024, mp4ArtifactBytes: 25 * 1024 * 1024, cacheBytes: 512 * 1024 * 1024,
});
export const EDITOR_MEDIA_ERROR_CODES = ['unsupported-platform', 'module-missing', 'invalid-input', 'unsupported-codec', 'corrupt-media',
    'cancelled', 'busy', 'disk-full', 'write-failed'] as const;
export type EditorMediaErrorCode = (typeof EDITOR_MEDIA_ERROR_CODES)[number];
export type EditorMediaProgressStage = 'preparing' | 'decoding' | 'encoding' | 'finishing';
export type EditorMediaError = { ok: false; code: EditorMediaErrorCode; reason?: string };
export type EditorMediaResult<T> = { ok: true; value: T } | EditorMediaError;
export type EditorMediaOperations = Readonly<Record<'inspect' | 'sampleFrames' | 'decodePcm' | 'mixAudio' | 'beginEncode' | 'appendFrameBatch' | 'finishEncode' | 'cancel' | 'cancelProject' | 'release', boolean>>;
export type EditorMediaCapability = { available: boolean; platform: 'ios' | 'android'; protocolVersion: 1; reason?: 'unsupported-platform' | 'module-missing'; operations: EditorMediaOperations };
export type EditorMediaProgress = { stage: EditorMediaProgressStage; value: number };
export type EditorMediaInfo = { durationUs: number; hasVideo: boolean; hasAudio: boolean; width?: number; height?: number; preferredTransform?: number[]; nominalFrameRate?: number;
    videoCodec?: string; videoStartUs?: number; videoDurationUs?: number; audioCodec?: string; audioStartUs?: number; audioDurationUs?: number };
export type EditorMediaArtifactKind = 'frames' | 'pcm' | 'mp4' | 'report';
export type EditorMediaArtifact = { artifactId: string; uri: string; kind: EditorMediaArtifactKind; size: number };
export type FrameArtifact = EditorMediaArtifact & { kind: 'frames'; width: 128; height: 72; stride: 512; pixelFormat: 'rgba8'; colorSpace: 'srgb'; count: number;
    timestampsUs: number[]; preferredTransform: number[]; resizeMode: 'contain' | 'fill'; samplingMode?: 'uniform' | 'all'; maximumFrameRate?: 60 };
export type PcmTimingSegment = { offsetFrames: number; timestampUs: number; frames: number };
export type PcmArtifact = EditorMediaArtifact & { kind: 'pcm'; sampleRate: 48000; channels: 1 | 2; frames: number; encoding: 'f32le-interleaved';
    mixMode?: 'web-average'; segments?: PcmTimingSegment[] };
export type Mp4Artifact = EditorMediaArtifact & { kind: 'mp4'; width: number; height: number; fps: number; frames: number; durationUs: number;
    videoCodec: 'avc1' | 'hvc1-alpha'; audioCodec?: 'mp4a'; audioSampleRate?: 48000; audioChannels?: 2 };
export type SampleFramesRequest = { uri: string; fromSeconds: number; toSeconds: number; maxFrames: number; resizeMode?: 'contain' | 'fill';
    samplingMode?: 'all'; maximumFrameRate?: 60 };
export type DecodePcmRequest = { uri: string; fromSeconds: number; toSeconds: number; sampleRate: 48000; channels: 1 | 2; mixMode?: 'web-average' };
export type LegacyAudioMixClip = { mediaId: string; timelineStartSeconds: number; sourceStartSeconds: number; durationSeconds: number;
    volume: number; fadeInSeconds: number; fadeOutSeconds: number };
export type AdvancedAudioMixClip = { mediaId: string; start: number; in: number; len: number; transitionOut: number;
    volume: number; fadeIn: number; fadeOut: number; rate: number; reverse: boolean; preservePitch: boolean;
    speedCurve?: readonly { frame: number; rate: number }[];
    audioProcessing: { pitch: number; voice: 'none' | 'deep' | 'bright' | 'radio' | 'robot'; noiseReduction: number; noiseStart: number; noiseLength: number; gateDb: number };
    audioEffects: { width: number; tremoloRate: number; tremoloDepth: number; echoDelay: number; echoDecay: number; echoRepeats: number; echoMix: number };
    pan: number; eq: { low: number; mid: number; high: number } };
export type AudioMixClip = LegacyAudioMixClip | AdvancedAudioMixClip;
export type AudioMixRequest = { clips: readonly AudioMixClip[]; sources: Readonly<Record<string, string>>; frames: number; fps: number };
export type BeginEncodeRequest = { width: number; height: number; fps: number; videoBitRate: number; audioBitRate?: number; audioArtifactId?: string; alpha?: boolean };
export type FrameDescriptor = { version: 1; uri: string; index: number; timestampUs: number; byteLength: number; width: number; height: number; stride: number;
    pixelFormat: 'rgba8'; colorSpace: 'srgb' };
export type EncodeSession = { sessionId: string; token: string; project: string; generation: number; width: number; height: number; fps: number; nextIndex: number;
    audioArtifactId?: string; alpha?: boolean };
export type EditorMediaProbeReport = {
    version: 1; run: 'first-process' | 'warm'; ingress: 'skia-rgba8-file-batches'; firstProcessMethod: string; frameCount: 900; width: 1280; height: 720; fps: 30;
    timingsMs: { renderReadback: number; fileWrite: number; nativeAppendEncode: number; finalize: number; total: number };
    bytes: { written: number; read: number; peakBatchDisk: number; output: number }; peakRssBytes?: number;
    verification: { videoCodec: 'avc1'; audioCodec: 'mp4a'; durationUs: number; audioVideoSkewUs: number; timestampToleranceUs: 1; colorTolerance: 12;
        cancelledClean: boolean; corruptClean: boolean; retryPassed: boolean; released: boolean };
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const positiveInteger = (value: unknown): value is number => integer(value) && value > 0;
const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const exact = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const codeSet = new Set<string>(EDITOR_MEDIA_ERROR_CODES), stages = new Set<string>(['preparing', 'decoding', 'encoding', 'finishing']);
const operationNames = ['inspect', 'sampleFrames', 'decodePcm', 'mixAudio', 'beginEncode', 'appendFrameBatch', 'finishEncode', 'cancel', 'cancelProject', 'release'] as const;
const unavailableOperations = Object.freeze(Object.fromEntries(operationNames.map(name => [name, false])) as EditorMediaOperations);
export function validIdentifier(value: unknown): value is string { return identifier(value); }
export function validateOwnedFileUri(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(value) || /%(?:2e|2f|5c)/i.test(value)
        || /\/(?:\.{1,2})(?:\/|$|[?#])/.test(value)) return false;
    try { const url = new URL(value); if (url.protocol !== 'file:' || url.host || url.username || url.password || url.search || url.hash) return false;
        return !decodeURIComponent(url.pathname).split('/').some(part => part === '.' || part === '..' || part.includes('\\')); } catch { return false; }
}
export function validateSampleFramesRequest(value: unknown): value is SampleFramesRequest {
    return object(value) && exact(value, ['uri', 'fromSeconds', 'toSeconds', 'maxFrames', 'resizeMode', 'samplingMode', 'maximumFrameRate']) && validateOwnedFileUri(value.uri) && finite(value.fromSeconds)
        && finite(value.toSeconds) && value.fromSeconds >= 0 && value.toSeconds > value.fromSeconds && value.toSeconds - value.fromSeconds <= EDITOR_MEDIA_LIMITS.durationSeconds
        && positiveInteger(value.maxFrames) && value.maxFrames <= (value.samplingMode === 'all' ? 1800 : 900)
        && (value.resizeMode === undefined || value.resizeMode === 'contain' || value.resizeMode === 'fill')
        && (value.samplingMode === undefined ? value.maximumFrameRate === undefined : value.samplingMode === 'all' && value.maximumFrameRate === 60);
}
export function validateDecodePcmRequest(value: unknown): value is DecodePcmRequest {
    return object(value) && exact(value, ['uri', 'fromSeconds', 'toSeconds', 'sampleRate', 'channels', 'mixMode']) && validateOwnedFileUri(value.uri) && finite(value.fromSeconds)
        && finite(value.toSeconds) && value.fromSeconds >= 0 && value.toSeconds > value.fromSeconds && value.toSeconds - value.fromSeconds <= EDITOR_MEDIA_LIMITS.durationSeconds
        && value.sampleRate === 48000 && [1, 2].includes(value.channels as number)
        && (value.mixMode === undefined || value.mixMode === 'web-average' && value.channels === 1);
}
export function validateAudioMixRequest(value: unknown): value is AudioMixRequest {
    if (!object(value) || !exact(value, ['clips', 'sources', 'frames', 'fps']) || !Array.isArray(value.clips) || value.clips.length > 80
        || !object(value.sources) || Object.keys(value.sources).length > 40 || !positiveInteger(value.frames) || value.frames > 1800
        || !positiveInteger(value.fps) || value.fps > 60 || value.frames > value.fps * EDITOR_MEDIA_LIMITS.durationSeconds) return false;
    if (Object.entries(value.sources).some(([mediaId, uri]) => !identifier(mediaId) || !validateOwnedFileUri(uri))) return false;
    const base = (clip: Record<string, unknown>) => identifier(clip.mediaId) && Object.hasOwn(value.sources as object, clip.mediaId as PropertyKey);
    const legacy = (clip: Record<string, unknown>) => exact(clip, ['mediaId', 'timelineStartSeconds', 'sourceStartSeconds', 'durationSeconds', 'volume', 'fadeInSeconds', 'fadeOutSeconds'])
        && base(clip) && finite(clip.timelineStartSeconds) && clip.timelineStartSeconds >= 0 && finite(clip.sourceStartSeconds) && clip.sourceStartSeconds >= 0
        && finite(clip.durationSeconds) && clip.durationSeconds > 0 && clip.durationSeconds <= EDITOR_MEDIA_LIMITS.durationSeconds
        && finite(clip.volume) && clip.volume >= 0 && clip.volume <= 4 && finite(clip.fadeInSeconds) && clip.fadeInSeconds >= 0
        && finite(clip.fadeOutSeconds) && clip.fadeOutSeconds >= 0;
    const bounded = (candidate: unknown, minimum: number, maximum: number) => finite(candidate) && candidate >= minimum && candidate <= maximum;
    const advanced = (clip: Record<string, unknown>) => {
        const eq = clip.eq;
        if (!exact(clip, ['mediaId', 'start', 'in', 'len', 'transitionOut', 'volume', 'fadeIn', 'fadeOut', 'rate', 'reverse', 'preservePitch',
            'speedCurve', 'audioProcessing', 'audioEffects', 'pan', 'eq']) || !base(clip)
            || !integer(clip.start) || clip.start < 0 || !integer(clip.in) || clip.in < 0 || !positiveInteger(clip.len) || clip.len > 1800
            || !integer(clip.transitionOut) || clip.transitionOut < 0 || clip.transitionOut > 60 || clip.len + clip.transitionOut > 1800
            || !bounded(clip.volume, 0, 4) || !integer(clip.fadeIn) || clip.fadeIn < 0 || !integer(clip.fadeOut) || clip.fadeOut < 0
            || !bounded(clip.rate, .1, 8) || typeof clip.reverse !== 'boolean' || typeof clip.preservePitch !== 'boolean'
            || !bounded(clip.pan, -1, 1) || !object(eq) || !exact(eq, ['low', 'mid', 'high'])
            || !['low', 'mid', 'high'].every(key => bounded(eq[key], -24, 24))) return false;
        if (clip.speedCurve !== undefined && (!Array.isArray(clip.speedCurve) || clip.speedCurve.length > 12 || clip.speedCurve.length === 1
            || clip.speedCurve.some((point, index, list) => !object(point) || !exact(point, ['frame', 'rate']) || !integer(point.frame)
                || point.frame < -18000 || point.frame > 18000 || !bounded(point.rate, .1, 8) || index > 0 && point.frame <= Number((list[index - 1] as Record<string, unknown>).frame)))) return false;
        const processing = clip.audioProcessing;
        if (!object(processing) || !exact(processing, ['pitch', 'voice', 'noiseReduction', 'noiseStart', 'noiseLength', 'gateDb'])
            || !bounded(processing.pitch, -12, 12) || !['none', 'deep', 'bright', 'radio', 'robot'].includes(String(processing.voice))
            || !bounded(processing.noiseReduction, 0, 1) || !bounded(processing.noiseStart, 0, 333_333)
            || !bounded(processing.noiseLength, .05, 2) || !bounded(processing.gateDb, -96, -6)) return false;
        const effects = clip.audioEffects;
        return object(effects) && exact(effects, ['width', 'tremoloRate', 'tremoloDepth', 'echoDelay', 'echoDecay', 'echoRepeats', 'echoMix'])
            && bounded(effects.width, 0, 2) && bounded(effects.tremoloRate, .1, 20) && bounded(effects.tremoloDepth, 0, 1)
            && bounded(effects.echoDelay, .01, 1) && bounded(effects.echoDecay, .05, .9) && integer(effects.echoRepeats)
            && bounded(effects.echoRepeats, 1, 8) && Number(effects.echoDelay) * Number(effects.echoRepeats) <= 4 && bounded(effects.echoMix, 0, 1);
    };
    return value.clips.every(clip => object(clip) && (legacy(clip) || advanced(clip)));
}
export function validateBeginEncodeRequest(value: unknown): value is BeginEncodeRequest {
    if (!object(value) || !exact(value, ['width', 'height', 'fps', 'videoBitRate', 'audioBitRate', 'audioArtifactId', 'alpha']) || !positiveInteger(value.width) || !positiveInteger(value.height)
        || value.width > 1280 || value.height > 1280 || value.width * value.height > 1280 * 720 || !positiveInteger(value.fps) || value.fps > 60
        || !positiveInteger(value.videoBitRate) || value.videoBitRate < 100_000 || value.videoBitRate > 50_000_000
        || value.audioBitRate !== undefined && (!positiveInteger(value.audioBitRate) || value.audioBitRate < 64_000 || value.audioBitRate > 512_000)
        || value.audioArtifactId !== undefined && !identifier(value.audioArtifactId) || value.audioBitRate !== undefined && value.audioArtifactId === undefined
        || value.alpha !== undefined && typeof value.alpha !== 'boolean') return false;
    const projectedMaximum = (value.videoBitRate + (value.audioArtifactId === undefined ? 0 : value.audioBitRate ?? 192_000))
        * EDITOR_MEDIA_LIMITS.durationSeconds / 8 + 1_048_576;
    return projectedMaximum <= EDITOR_MEDIA_LIMITS.mp4ArtifactBytes;
}
export function frameTimestampUs(index: number, fps: number) { return Math.round(index * 1_000_000 / fps); }
export function validateFrameBatch(value: unknown, session: EncodeSession): value is FrameDescriptor[] {
    if (!Array.isArray(value) || !value.length || value.length > EDITOR_MEDIA_LIMITS.batchFrames) return false; let bytes = 0;
    for (let offset = 0; offset < value.length; offset++) { const frame = value[offset];
        if (!object(frame) || !exact(frame, ['version', 'uri', 'index', 'timestampUs', 'byteLength', 'width', 'height', 'stride', 'pixelFormat', 'colorSpace'])
            || frame.version !== 1 || !validateOwnedFileUri(frame.uri) || frame.index !== session.nextIndex + offset || frame.timestampUs !== frameTimestampUs(frame.index, session.fps)
            || frame.width !== session.width || frame.height !== session.height || frame.stride !== session.width * 4 || frame.pixelFormat !== 'rgba8'
            || frame.colorSpace !== 'srgb' || frame.byteLength !== frame.stride * frame.height || !positiveInteger(frame.byteLength)) return false; bytes += frame.byteLength; }
    return Number.isSafeInteger(bytes) && bytes <= EDITOR_MEDIA_LIMITS.batchBytes;
}
export function parseError(value: unknown): EditorMediaError | null {
    if (!object(value)) return null; const code = value.cancelled === true ? 'cancelled' : typeof value.error === 'string' ? value.error
        : typeof value.code === 'string' && value.ok === false ? value.code : null;
    if (!code || !codeSet.has(code)) return null; const reason = typeof value.reason === 'string' && /^[a-z0-9-]{1,80}$/.test(value.reason) ? value.reason : undefined;
    return { ok: false, code: code as EditorMediaErrorCode, ...(reason ? { reason } : {}) };
}
export function parseCapability(value: unknown, missing = false): EditorMediaCapability {
    if (missing || !object(value) || value.ok !== true || typeof value.available !== 'boolean' || value.protocolVersion !== 1 || !['ios', 'android'].includes(String(value.platform)))
        return { available: false, platform: 'ios', protocolVersion: 1, reason: 'module-missing', operations: unavailableOperations };
    const platform = value.platform as 'ios' | 'android', raw = object(value.operations) ? value.operations : {};
    const operations = Object.freeze(Object.fromEntries(operationNames.map(name => [name, raw[name] === true])) as EditorMediaOperations);
    return value.available ? { available: true, platform, protocolVersion: 1, operations }
        : { available: false, platform, protocolVersion: 1, reason: value.reason === 'unsupported-platform' ? 'unsupported-platform' : 'module-missing', operations };
}
function parseArtifactBase(value: unknown, kind: EditorMediaArtifactKind, limit: number): EditorMediaArtifact | null {
    if (!object(value) || value.ok !== true || !identifier(value.artifactId) || !validateOwnedFileUri(value.uri) || value.kind !== kind || !positiveInteger(value.size) || value.size > limit) return null;
    return { artifactId: value.artifactId as string, uri: value.uri as string, kind, size: value.size };
}
export function parseMediaInfo(value: unknown): EditorMediaInfo | null {
    if (!object(value) || value.ok !== true || !finite(value.duration) || value.duration <= 0 || value.duration > 86_400
        || typeof value.hasVideo !== 'boolean' || typeof value.hasAudio !== 'boolean' || !value.hasVideo && !value.hasAudio) return null;
    const codec = (candidate: unknown) => typeof candidate === 'string' && /^[A-Za-z0-9._ -]{1,32}$/.test(candidate);
    const track = (start: unknown, duration: unknown) => integer(start) && start >= 0 && positiveInteger(duration) && duration <= 86_400_000_000;
    if (value.hasVideo) {
        if (!positiveInteger(value.width) || !positiveInteger(value.height) || value.width > 8192 || value.height > 8192
            || !Array.isArray(value.transform) || value.transform.length !== 6 || !value.transform.every(finite)
            || !finite(value.nominalFrameRate) || value.nominalFrameRate < 0 || value.nominalFrameRate > 240 || !codec(value.videoCodec)
            || !track(value.videoStartUs, value.videoDurationUs)) return null;
    } else if ([value.width, value.height, value.transform, value.nominalFrameRate, value.videoCodec, value.videoStartUs, value.videoDurationUs].some(field => field !== undefined)) return null;
    if (value.hasAudio) {
        if (!codec(value.audioCodec) || !track(value.audioStartUs, value.audioDurationUs)) return null;
    } else if ([value.audioCodec, value.audioStartUs, value.audioDurationUs].some(field => field !== undefined)) return null;
    return { durationUs: Math.round(value.duration * 1_000_000), hasVideo: value.hasVideo, hasAudio: value.hasAudio,
        ...(value.hasVideo ? { width: value.width as number, height: value.height as number, preferredTransform: value.transform as number[],
            ...((value.nominalFrameRate as number) > 0 ? { nominalFrameRate: value.nominalFrameRate as number } : {}), videoCodec: value.videoCodec as string,
            videoStartUs: value.videoStartUs as number, videoDurationUs: value.videoDurationUs as number } : {}),
        ...(value.hasAudio ? { audioCodec: value.audioCodec as string, audioStartUs: value.audioStartUs as number, audioDurationUs: value.audioDurationUs as number } : {}) };
}
export function parseFrameArtifact(value: unknown, request: Pick<SampleFramesRequest, 'maxFrames' | 'resizeMode' | 'samplingMode' | 'maximumFrameRate'> = { maxFrames: 900 }): FrameArtifact | null {
    const base = parseArtifactBase(value, 'frames', EDITOR_MEDIA_LIMITS.frameArtifactBytes); if (!base || !object(value)) return null;
    const resizeMode = value.resizeMode === undefined ? 'contain' : value.resizeMode;
    const samplingMode = value.samplingMode === undefined ? 'uniform' : value.samplingMode;
    const expectedResizeMode = request.resizeMode ?? 'contain', expectedSamplingMode = request.samplingMode ?? 'uniform';
    if (value.width !== 128 || value.height !== 72 || value.stride !== 512 || value.pixelFormat !== 'rgba8' || value.colorSpace !== 'srgb' || !positiveInteger(value.count)
        || value.count > request.maxFrames || !Array.isArray(value.timestampsUs) || value.timestampsUs.length !== value.count || !value.timestampsUs.every((time, index) => integer(time) && time >= 0
            && (!index || time > (value.timestampsUs as number[])[index - 1])) || !Array.isArray(value.preferredTransform) || value.preferredTransform.length !== 6
        || !value.preferredTransform.every(finite) || !['contain', 'fill'].includes(String(resizeMode)) || resizeMode !== expectedResizeMode
        || !['uniform', 'all'].includes(String(samplingMode)) || samplingMode !== expectedSamplingMode
        || (expectedSamplingMode === 'all' ? request.maximumFrameRate !== 60 || value.maximumFrameRate !== 60 : value.maximumFrameRate !== undefined)) return null;
    return { ...base, kind: 'frames', width: 128, height: 72, stride: 512, pixelFormat: 'rgba8', colorSpace: 'srgb', count: value.count,
        timestampsUs: value.timestampsUs as number[], preferredTransform: value.preferredTransform as number[], resizeMode: resizeMode as 'contain' | 'fill',
        samplingMode: samplingMode as 'uniform' | 'all', ...(expectedSamplingMode === 'all' ? { maximumFrameRate: 60 as const } : {}) };
}
export function parsePcmArtifact(value: unknown, expectedMixMode?: DecodePcmRequest['mixMode']): PcmArtifact | null {
    const base = parseArtifactBase(value, 'pcm', EDITOR_MEDIA_LIMITS.pcmArtifactBytes); if (!base || !object(value) || value.sampleRate !== 48000
        || ![1, 2].includes(value.channels as number) || !positiveInteger(value.frames) || value.frames > 1_440_000 || value.encoding !== 'f32le-interleaved'
        || value.size !== value.frames * (value.channels as number) * 4) return null;
    if (expectedMixMode === undefined) {
        if (value.mixMode !== undefined || value.segments !== undefined) return null;
        return { ...base, kind: 'pcm', sampleRate: 48000, channels: value.channels as 1 | 2, frames: value.frames, encoding: 'f32le-interleaved' };
    }
    if (expectedMixMode !== 'web-average' || value.mixMode !== expectedMixMode || value.channels !== 1 || !Array.isArray(value.segments)
        || !value.segments.length || value.segments.length > 4096) return null;
    const segments: PcmTimingSegment[] = []; let nextOffset = 0, previousTimestamp = -1;
    for (const raw of value.segments) {
        if (!object(raw) || !exact(raw, ['offsetFrames', 'timestampUs', 'frames']) || raw.offsetFrames !== nextOffset || !positiveInteger(raw.frames)
            || !integer(raw.timestampUs) || raw.timestampUs < 0 || raw.timestampUs <= previousTimestamp) return null;
        segments.push({ offsetFrames: raw.offsetFrames as number, timestampUs: raw.timestampUs as number, frames: raw.frames as number });
        nextOffset += raw.frames as number;
        if (!Number.isSafeInteger(nextOffset) || nextOffset > (value.frames as number)) return null;
        previousTimestamp = raw.timestampUs as number;
    }
    if (nextOffset !== value.frames) return null;
    return { ...base, kind: 'pcm', sampleRate: 48000, channels: 1, frames: value.frames, encoding: 'f32le-interleaved', mixMode: 'web-average', segments };
}
export function parseMp4Artifact(value: unknown): Mp4Artifact | null {
    const base = parseArtifactBase(value, 'mp4', EDITOR_MEDIA_LIMITS.mp4ArtifactBytes); if (!base || !object(value) || !positiveInteger(value.width) || !positiveInteger(value.height)
        || value.width > 1280 || value.height > 1280 || value.width * value.height > 1280 * 720 || !positiveInteger(value.fps) || value.fps > 60
        || !positiveInteger(value.frames) || value.frames > value.fps * 30 || !positiveInteger(value.durationUs) || value.durationUs > 30_000_000
        || value.durationUs !== frameTimestampUs(value.frames, value.fps) || !['avc1', 'hvc1-alpha'].includes(String(value.videoCodec))
        || value.audioCodec !== undefined && value.audioCodec !== 'mp4a' || value.audioSampleRate !== undefined && value.audioSampleRate !== 48000
        || value.audioChannels !== undefined && value.audioChannels !== 2
        || value.audioCodec === undefined !== (value.audioSampleRate === undefined && value.audioChannels === undefined)) return null;
    return { ...base, kind: 'mp4', width: value.width, height: value.height, fps: value.fps, frames: value.frames, durationUs: value.durationUs,
        videoCodec: value.videoCodec as 'avc1' | 'hvc1-alpha',
        ...(value.audioCodec === 'mp4a' ? { audioCodec: 'mp4a' as const, audioSampleRate: 48000 as const, audioChannels: 2 as const } : {}) };
}
export function parseProgress(value: unknown): EditorMediaProgress | null {
    return object(value) && stages.has(String(value.stage)) && finite(value.value) && value.value >= 0 && value.value <= 1
        ? { stage: value.stage as EditorMediaProgressStage, value: value.value } : null;
}
export function parseProbeReport(value: unknown): EditorMediaProbeReport | null {
    if (!object(value) || value.version !== 1 || !['first-process', 'warm'].includes(String(value.run)) || value.ingress !== 'skia-rgba8-file-batches'
        || typeof value.firstProcessMethod !== 'string' || !value.firstProcessMethod || value.frameCount !== 900 || value.width !== 1280 || value.height !== 720 || value.fps !== 30
        || !object(value.timingsMs) || !object(value.bytes) || !object(value.verification)) return null;
    const timings = value.timingsMs, bytes = value.bytes, proof = value.verification;
    if (!['renderReadback', 'fileWrite', 'nativeAppendEncode', 'finalize', 'total'].every(key => finite(timings[key]) && (timings[key] as number) >= 0)
        || !['written', 'read', 'peakBatchDisk', 'output'].every(key => positiveInteger(bytes[key])) || (bytes.peakBatchDisk as number) > EDITOR_MEDIA_LIMITS.batchBytes
        || (bytes.output as number) > EDITOR_MEDIA_LIMITS.mp4ArtifactBytes || value.peakRssBytes !== undefined && !positiveInteger(value.peakRssBytes)
        || proof.videoCodec !== 'avc1' || proof.audioCodec !== 'mp4a' || !positiveInteger(proof.durationUs) || Math.abs(proof.durationUs - 30_000_000) > 33_334
        || !integer(proof.audioVideoSkewUs)
        || Math.abs(proof.audioVideoSkewUs) > 33_334 || proof.timestampToleranceUs !== 1 || proof.colorTolerance !== 12
        || !['cancelledClean', 'corruptClean', 'retryPassed', 'released'].every(key => proof[key] === true)) return null;
    return value as EditorMediaProbeReport;
}
export function probePassesArchitectureGate(reports: readonly EditorMediaProbeReport[]) {
    const runs = reports.filter(report => report.run === 'first-process').map(report => report.timingsMs.total).sort((a, b) => a - b);
    return runs.length >= 3 && runs[Math.floor(runs.length / 2)] <= 90_000 && runs.every(value => value <= 120_000);
}
