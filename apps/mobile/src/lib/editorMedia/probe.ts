import type * as SkiaModule from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { EDITOR_MEDIA_LIMITS, frameTimestampUs, probePassesArchitectureGate, type EditorMediaProbeReport, type EncodeSession, type FrameDescriptor } from './protocol';

export const S9_PROBE_FLAG = 'EXPO_PUBLIC_DEV_S9_MEDIA_PROBE';
export const S9_PROBE_PROJECT = 's9-editor-media-probe';
export const S9_PROBE_FRAMES = 900;
export const S9_PROBE_WIDTH = 1280;
export const S9_PROBE_HEIGHT = 720;
export const S9_PROBE_FPS = 30;
const FRAME_BYTES = S9_PROBE_WIDTH * S9_PROBE_HEIGHT * 4;
const ANALYSIS_FRAME_BYTES = EDITOR_MEDIA_LIMITS.analysisWidth * EDITOR_MEDIA_LIMITS.analysisHeight * 4;
const AUDIO_RATE = 48_000;
const AUDIO_SECONDS = 30;
// One-second 32x16 constrained-baseline H.264 MP4 with four distinct color quadrants and a
// 90-degree ISO display matrix. The asymmetric pixels make an incorrect rotation observable.
const ROTATED_MP4_BASE64 = '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';

export type EditorMediaProbeCheck = boolean | null;
export type EditorMediaProbeEvidence = {
    schemaVersion: 1;
    status: 'passed' | 'blocked' | 'failed';
    run: 'first-process' | 'warm';
    startedAt: string;
    completedAt: string;
    method: string;
    reportUri?: string;
    archiveUri?: string;
    architectureReport: EditorMediaProbeReport | null;
    timingsMs: EditorMediaProbeReport['timingsMs'] & { audioFixture: number; verification: number };
    bytes: EditorMediaProbeReport['bytes'];
    checks: {
        uniqueFrames: EditorMediaProbeCheck; timestamps: EditorMediaProbeCheck; colors: EditorMediaProbeCheck;
        audioVideoSkew: EditorMediaProbeCheck; codecs: EditorMediaProbeCheck; duration: EditorMediaProbeCheck;
        cancelledClean: EditorMediaProbeCheck; corruptClean: EditorMediaProbeCheck; retryPassed: EditorMediaProbeCheck;
        released: EditorMediaProbeCheck; rotatedSource: EditorMediaProbeCheck;
    };
    blockers: string[];
    failure?: string;
};

type ProbeOptions = { account: string; signal?: AbortSignal; onStatus?(status: string): void };
type SampleManifest = { frames: { file: string; timestampUs: number }[] };
type SkiaApi = typeof SkiaModule.Skia;
type ProbeSurface = NonNullable<ReturnType<SkiaApi['Surface']['Make']>>;
let runsInProcess = 0;
let preparedAccount: string | null = null;
const now = () => globalThis.performance?.now?.() ?? Date.now();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const stopped = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('probe-cancelled'); };
const safeDelete = (entry: File | Directory) => { try { if (entry.exists) entry.delete(); } catch { /* Probe cleanup remains best effort. */ } };
const stableFailure = (error: unknown) => error instanceof Error && /^probe-[a-z0-9-]+$/.test(error.message) ? error.message : 'probe-failed';
const decodeBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

function wav30Seconds(): Uint8Array {
    const frames = AUDIO_RATE * AUDIO_SECONDS, dataBytes = frames * 2 * 4, bytes = new Uint8Array(44 + dataBytes), view = new DataView(bytes.buffer);
    const ascii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, AUDIO_RATE, true); view.setUint32(28, AUDIO_RATE * 8, true);
    view.setUint16(32, 8, true); view.setUint16(34, 32, true); ascii(36, 'data'); view.setUint32(40, dataBytes, true);
    for (let frame = 0; frame < frames; frame++) {
        const sample = Math.sin(frame * 2 * Math.PI * 440 / AUDIO_RATE) * 0.18, offset = 44 + frame * 8;
        view.setFloat32(offset, sample, true); view.setFloat32(offset + 4, sample, true);
    }
    return bytes;
}

function loadSkia(): typeof SkiaModule {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- benchmark-only native renderer stays out of ordinary editor-media imports
    return require('@shopify/react-native-skia') as typeof SkiaModule;
}
function loadEditorMedia(): typeof import('./index').editorMedia {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- avoids a barrel cycle while keeping the probe exported from that barrel
    return (require('./index') as typeof import('./index')).editorMedia;
}
function drawFrame(skia: SkiaApi, colorType: SkiaModule.ColorType, alphaType: SkiaModule.AlphaType, surface: ProbeSurface, index: number, runSeed: number): Uint8Array {
    const canvas = surface.getCanvas(), paint = skia.Paint();
    try {
        paint.setAntiAlias(false); paint.setColor(skia.Color('#ff0000')); canvas.drawRect({ x: 0, y: 0, width: 640, height: 720 }, paint);
        paint.setColor(skia.Color('#0000ff')); canvas.drawRect({ x: 640, y: 0, width: 640, height: 720 }, paint);
        for (let bit = 0; bit < 10; bit++) {
            paint.setColor(skia.Color(index & 1 << bit ? '#ffffff' : '#000000'));
            canvas.drawRect({ x: bit * 64, y: 0, width: 64, height: 96 }, paint);
        }
        paint.setColor(skia.Color('#00ff00')); canvas.drawRect({ x: (index * 17 + runSeed) % 1280, y: 640 + (index + runSeed) % 64, width: 2, height: 16 }, paint);
        surface.flush(true);
        const pixels = canvas.readPixels(0, 0, { width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, colorType, alphaType });
        if (!pixels || pixels.length !== FRAME_BYTES) throw new Error('probe-read-pixels');
        return new Uint8Array(pixels);
    } finally { paint.dispose(); }
}

function checkPixel(bytes: Uint8Array, x: number, y: number, expected: readonly [number, number, number], tolerance = 12) {
    const at = (y * 128 + x) * 4;
    return expected.every((value, channel) => Math.abs(bytes[at + channel] - value) <= tolerance);
}
function decodedIndex(bytes: Uint8Array) {
    let result = 0;
    for (let bit = 0; bit < 10; bit++) {
        const x = Math.floor((bit * 64 + 32) * 128 / S9_PROBE_WIDTH), y = 5, at = (y * 128 + x) * 4;
        if (bytes[at] + bytes[at + 1] + bytes[at + 2] > 384) result |= 1 << bit;
    }
    return result;
}

async function waitForCancelledProject(projectDir: Directory) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const partial = projectDir.exists && projectDir.list().some(entry => entry.name.startsWith('vx-mp4-'));
        if (!partial) return true;
        await delay(50);
    }
    return false;
}

export function architectureDecision(reports: readonly EditorMediaProbeReport[], checks: EditorMediaProbeEvidence['checks']) {
    return Object.values(checks).every(value => value === true) && probePassesArchitectureGate(reports);
}

export async function runEditorMediaProbe({ account, signal, onStatus }: ProbeOptions): Promise<EditorMediaProbeEvidence> {
    const editorMedia = loadEditorMedia();
    const run: EditorMediaProbeEvidence['run'] = runsInProcess++ === 0 ? 'first-process' : 'warm';
    const startedAt = new Date().toISOString(), method = 'fresh app process for first-process; unique Skia content and filenames; no pre-read; host OS cache not evicted';
    const runSeed = [...startedAt].reduce((seed, char) => (seed * 33 + char.charCodeAt(0)) >>> 0, 5381);
    const timings = { renderReadback: 0, fileWrite: 0, nativeAppendEncode: 0, finalize: 0, total: 0, audioFixture: 0, verification: 0 };
    const bytes = { written: 0, read: 0, peakBatchDisk: 0, output: 0 };
    const checks: EditorMediaProbeEvidence['checks'] = { uniqueFrames: null, timestamps: null, colors: null, audioVideoSkew: null, codecs: null, duration: null,
        cancelledClean: null, corruptClean: null, retryPassed: null, released: null, rotatedSource: null };
    const blockers: string[] = [];
    const directory = new Directory(Paths.cache, 'veyrnox-editor-media', account, S9_PROBE_PROJECT);
    const reportFile = new File(directory, 'report.json'), archiveFile = new File(directory, `report-${Date.now()}-${run}.json`);
    const wav = new File(directory, `vx-probe-audio-${Date.now()}.wav`);
    const rotated = new File(directory, `vx-probe-rotated-${Date.now()}.mp4`);
    const corrupt = new File(directory, `vx-probe-corrupt-${Date.now()}.mp4`), remainingFrames = new Set<File>();
    let pcmArtifact: string | undefined, outputArtifact: string | undefined, sampleArtifact: string | undefined, decodedOutputArtifact: string | undefined,
        rotatedArtifact: string | undefined;
    let activeSession: EncodeSession | undefined;
    let outputUri: string | undefined, evidence: EditorMediaProbeEvidence, diagnostic = '';
    try {
        if (Platform.OS !== 'ios') throw new Error('probe-ios-only');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(account)) throw new Error('probe-invalid-account');
        onStatus?.('Checking native capability');
        await editorMedia.setOwner(account); const capability = await editorMedia.capabilities();
        if (!capability.available || !capability.operations.beginEncode) throw new Error('probe-native-unavailable');
        if (preparedAccount !== account) { await editorMedia.bumpProjectGeneration(S9_PROBE_PROJECT); preparedAccount = account; }
        directory.create({ intermediates: true, idempotent: true });

        onStatus?.('Testing cancellation and corrupt input');
        const cancelled = await editorMedia.beginEncode(S9_PROBE_PROJECT, { width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, fps: S9_PROBE_FPS, videoBitRate: 6_000_000 });
        if (!cancelled.ok) throw new Error('probe-cancel-setup');
        editorMedia.cancel(cancelled.value);
        checks.cancelledClean = await waitForCancelledProject(directory);
        const cancellationRetry = checks.cancelledClean
            ? await editorMedia.beginEncode(S9_PROBE_PROJECT,
                { width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, fps: S9_PROBE_FPS, videoBitRate: 6_000_000 })
            : { ok: false as const, code: 'busy' as const };
        let cancellationRetryClean = false;
        if (cancellationRetry.ok) {
            editorMedia.cancel(cancellationRetry.value);
            cancellationRetryClean = await waitForCancelledProject(directory);
        }
        await corrupt.write(new Uint8Array([0x76, 0x78, 0x39]));
        const corruptResult = await editorMedia.sampleFrames(S9_PROBE_PROJECT, { uri: corrupt.uri, fromSeconds: 0, toSeconds: 1, maxFrames: 1 });
        bytes.read += corrupt.size;
        checks.corruptClean = !corruptResult.ok && corruptResult.code === 'corrupt-media'
            && !directory.list().some(entry => entry.name.startsWith('vx-frames-'));

        onStatus?.('Verifying rotated-source transform');
        await rotated.write(decodeBase64(ROTATED_MP4_BASE64));
        const rotatedInfo = await editorMedia.inspect(S9_PROBE_PROJECT, rotated.uri);
        const rotatedFrames = await editorMedia.sampleFrames(S9_PROBE_PROJECT,
            { uri: rotated.uri, fromSeconds: 0, toSeconds: 1, maxFrames: 1 });
        bytes.read += rotated.size * 2;
        if (rotatedFrames.ok) rotatedArtifact = rotatedFrames.value.artifactId;
        const transform = rotatedInfo.ok ? rotatedInfo.value.preferredTransform : undefined;
        let rotatedPixelsValid = false, rotatedPixelSamples: number[][] = [];
        if (rotatedFrames.ok) {
            const rotatedManifest = JSON.parse(await new File(rotatedFrames.value.uri).text()) as SampleManifest;
            const rotatedRecord = rotatedManifest.frames[0];
            if (rotatedRecord) {
                const pixels = await new File(new File(rotatedFrames.value.uri).parentDirectory, rotatedRecord.file).bytes();
                rotatedPixelSamples = [[55, 9], [73, 9], [55, 63], [73, 63], [4, 36], [123, 36]].map(([x, y]) => {
                    const at = (y * 128 + x) * 4; return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
                });
                // Core Image exposes the oriented bitmap top-to-bottom here. The fixture's 90-degree
                // counter-clockwise display matrix yields green/yellow above red/blue after orientation.
                rotatedPixelsValid = checkPixel(pixels, 55, 9, [0, 128, 0], 64)
                    && checkPixel(pixels, 73, 9, [255, 255, 0], 48)
                    && checkPixel(pixels, 55, 63, [255, 0, 0], 48)
                    && checkPixel(pixels, 73, 63, [0, 0, 255], 48)
                    && checkPixel(pixels, 4, 36, [0, 0, 0]) && checkPixel(pixels, 123, 36, [0, 0, 0]);
            }
        }
        const rotatedInfoValid = rotatedInfo.ok && rotatedInfo.value.hasVideo;
        const rotatedSizeValid = rotatedInfo.ok && rotatedInfo.value.width === 16 && rotatedInfo.value.height === 32;
        const rotatedTransformValid = !!transform && transform.length === 6 && Math.abs(transform[0]) < 0.001
            && Math.abs(Math.abs(transform[1]) - 1) < 0.001 && Math.abs(Math.abs(transform[2]) - 1) < 0.001
            && Math.abs(transform[1] + transform[2]) < 0.001 && Math.abs(transform[3]) < 0.001;
        const rotatedFrameValid = rotatedFrames.ok && rotatedFrames.value.count === 1
            && !!transform && rotatedFrames.value.preferredTransform.every((value, index) => value === transform[index]);
        diagnostic = JSON.stringify({ transform, sampledTransform: rotatedFrames.ok ? rotatedFrames.value.preferredTransform : null,
            rotatedFrameError: rotatedFrames.ok ? null : rotatedFrames.code, rotatedPixelSamples });
        checks.rotatedSource = rotatedInfoValid && rotatedSizeValid && rotatedTransformValid && rotatedFrameValid && rotatedPixelsValid;
        if (!rotatedInfoValid) blockers.push('rotated-info');
        if (!rotatedSizeValid) blockers.push('rotated-size');
        if (!rotatedTransformValid) blockers.push('rotated-transform');
        if (!rotatedFrameValid) blockers.push('rotated-frame');
        if (!rotatedPixelsValid) blockers.push('rotated-pixels');
        if (!checks.rotatedSource) throw new Error('probe-rotated-source');
        checks.retryPassed = cancellationRetry.ok && cancellationRetryClean && checks.corruptClean === true && rotatedFrames.ok;
        if (!checks.retryPassed) throw new Error('probe-retry-failed');
        const rotatedReleased = await editorMedia.release(S9_PROBE_PROJECT, rotatedArtifact!);
        if (!rotatedReleased.ok) throw new Error('probe-release');
        rotatedArtifact = undefined;

        onStatus?.('Creating and decoding 48 kHz stereo fixture');
        let tick = now(); await wav.write(wav30Seconds()); timings.audioFixture += now() - tick; tick = now();
        const decoded = await editorMedia.decodePcm(S9_PROBE_PROJECT, { uri: wav.uri, fromSeconds: 0, toSeconds: 30, sampleRate: 48000, channels: 2 });
        timings.audioFixture += now() - tick;
        if (!decoded.ok) throw new Error('probe-audio-decode'); pcmArtifact = decoded.value.artifactId; bytes.read += wav.size;

        onStatus?.('Encoding 900 public-ingress frames');
        const videoStart = now();
        let sessionResult = await editorMedia.beginEncode(S9_PROBE_PROJECT, { width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, fps: S9_PROBE_FPS,
            videoBitRate: 6_000_000, audioBitRate: 192_000, audioArtifactId: pcmArtifact });
        for (let retry = 0; !sessionResult.ok && sessionResult.code === 'busy' && retry < 20; retry++) { await delay(50); sessionResult = await editorMedia.beginEncode(S9_PROBE_PROJECT,
            { width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, fps: S9_PROBE_FPS, videoBitRate: 6_000_000, audioBitRate: 192_000, audioArtifactId: pcmArtifact }); }
        if (!sessionResult.ok) throw new Error('probe-retry-failed');
        let session: EncodeSession = sessionResult.value; activeSession = session;
        const { Skia: skia, ColorType, AlphaType } = loadSkia();
        const surface = skia.Surface.Make(S9_PROBE_WIDTH, S9_PROBE_HEIGHT);
        if (!surface) throw new Error('probe-surface');
        try {
            for (let batchStart = 0; batchStart < S9_PROBE_FRAMES; batchStart += EDITOR_MEDIA_LIMITS.batchFrames) {
                stopped(signal); const descriptors: FrameDescriptor[] = [], batchFiles: File[] = [];
                for (let index = batchStart; index < Math.min(batchStart + EDITOR_MEDIA_LIMITS.batchFrames, S9_PROBE_FRAMES); index++) {
                    tick = now(); const pixels = drawFrame(skia, ColorType.RGBA_8888, AlphaType.Unpremul, surface, index, runSeed); timings.renderReadback += now() - tick;
                    const file = new File(directory, `vx-frame-${startedAt.replace(/\D/g, '')}-${String(index).padStart(4, '0')}.rgba`); remainingFrames.add(file); batchFiles.push(file);
                    tick = now(); await file.write(pixels); timings.fileWrite += now() - tick; bytes.written += pixels.byteLength;
                    descriptors.push({ version: 1, uri: file.uri, index, timestampUs: frameTimestampUs(index, S9_PROBE_FPS), byteLength: pixels.byteLength,
                        width: S9_PROBE_WIDTH, height: S9_PROBE_HEIGHT, stride: S9_PROBE_WIDTH * 4, pixelFormat: 'rgba8', colorSpace: 'srgb' });
                }
                const batchDiskBytes = batchFiles.reduce((sum, file) => sum + file.size, 0);
                if (batchDiskBytes > EDITOR_MEDIA_LIMITS.batchBytes) throw new Error('probe-batch-disk');
                bytes.peakBatchDisk = Math.max(bytes.peakBatchDisk, batchDiskBytes);
                tick = now(); const appended = await editorMedia.appendFrameBatch(session, descriptors); timings.nativeAppendEncode += now() - tick;
                if (!appended.ok) {
                    diagnostic += `; ${JSON.stringify({ appendAt: batchStart, appendCode: appended.code, appendReason: appended.reason ?? null })}`;
                    throw new Error('probe-append');
                }
                bytes.read += batchDiskBytes;
                session = appended.value; activeSession = session;
                if (batchFiles.some(file => file.exists)) throw new Error('probe-frame-not-consumed');
                batchFiles.forEach(file => remainingFrames.delete(file));
                onStatus?.(`Encoded ${session.nextIndex}/${S9_PROBE_FRAMES}`);
            }
            tick = now(); const finished = await editorMedia.finishEncode(session); timings.finalize = now() - tick;
            activeSession = undefined;
            if (!finished.ok) {
                diagnostic += `; ${JSON.stringify({ finishCode: finished.code, finishReason: finished.reason ?? null })}`;
                throw new Error('probe-finish');
            }
            outputArtifact = finished.value.artifactId; outputUri = finished.value.uri; bytes.output = finished.value.size;
            bytes.read += decoded.value.size;
            checks.codecs = finished.value.videoCodec === 'avc1' && finished.value.audioCodec === 'mp4a';
            checks.duration = Math.abs(finished.value.durationUs - 30_000_000) <= Math.ceil(1_000_000 / S9_PROBE_FPS);
        } finally { surface.dispose(); timings.total = now() - videoStart; }
        if (pcmArtifact) { const released = await editorMedia.release(S9_PROBE_PROJECT, pcmArtifact); if (!released.ok) throw new Error('probe-release'); pcmArtifact = undefined; }

        onStatus?.('Verifying timestamps, pixels, audio, and release'); tick = now();
        const inspected = await editorMedia.inspect(S9_PROBE_PROJECT, outputUri!);
        bytes.read += bytes.output;
        if (!inspected.ok || !inspected.value.hasVideo || !inspected.value.hasAudio) throw new Error('probe-inspect');
        const inspectedSkewUs = inspected.value.audioStartUs! + inspected.value.audioDurationUs!
            - inspected.value.videoStartUs! - inspected.value.videoDurationUs!;
        checks.codecs = checks.codecs === true && inspected.value.videoCodec === 'avc1' && inspected.value.audioCodec === 'mp4a';
        checks.duration = checks.duration === true && Math.abs(inspected.value.durationUs - 30_000_000) <= Math.ceil(1_000_000 / S9_PROBE_FPS)
            && Math.abs(inspected.value.videoDurationUs! - 30_000_000) <= Math.ceil(1_000_000 / S9_PROBE_FPS);
        const sampled = await editorMedia.sampleFrames(S9_PROBE_PROJECT, { uri: outputUri!, fromSeconds: 0, toSeconds: 30, maxFrames: S9_PROBE_FRAMES });
        if (!sampled.ok) throw new Error('probe-output-sample'); sampleArtifact = sampled.value.artifactId;
        bytes.read += bytes.output + S9_PROBE_FRAMES * ANALYSIS_FRAME_BYTES;
        checks.uniqueFrames = sampled.value.count === S9_PROBE_FRAMES;
        checks.timestamps = sampled.value.timestampsUs.length === S9_PROBE_FRAMES
            && sampled.value.timestampsUs.every((value, index) => Math.abs(value - frameTimestampUs(index, S9_PROBE_FPS)) <= 1);
        const manifest = JSON.parse(await new File(sampled.value.uri).text()) as SampleManifest;
        let colors = true;
        for (let index = 0; index < S9_PROBE_FRAMES; index++) {
            const record = manifest.frames[index]; if (!record) { colors = false; break; }
            const pixels = await new File(new File(sampled.value.uri).parentDirectory, record.file).bytes();
            colors &&= checkPixel(pixels, 16, 36, [255, 0, 0]) && checkPixel(pixels, 112, 36, [0, 0, 255]) && decodedIndex(pixels) === index;
        }
        checks.colors = colors;
        const outputAudio = await editorMedia.decodePcm(S9_PROBE_PROJECT, { uri: outputUri!, fromSeconds: 0, toSeconds: 30, sampleRate: 48000, channels: 2 });
        bytes.read += bytes.output;
        if (!outputAudio.ok) throw new Error('probe-output-audio'); decodedOutputArtifact = outputAudio.value.artifactId;
        const audioDurationUs = Math.round(outputAudio.value.frames * 1_000_000 / AUDIO_RATE), decodedSkewUs = audioDurationUs - 30_000_000;
        const audioVideoSkewUs = inspectedSkewUs;
        checks.audioVideoSkew = Math.abs(inspectedSkewUs) <= Math.ceil(1_000_000 / S9_PROBE_FPS)
            && Math.abs(decodedSkewUs) <= Math.ceil(1_000_000 / S9_PROBE_FPS);
        const decodedReleased = await editorMedia.release(S9_PROBE_PROJECT, decodedOutputArtifact); if (decodedReleased.ok) decodedOutputArtifact = undefined;
        const sampledReleased = await editorMedia.release(S9_PROBE_PROJECT, sampleArtifact); if (sampledReleased.ok) sampleArtifact = undefined;
        const outputReleased = await editorMedia.release(S9_PROBE_PROJECT, outputArtifact); if (outputReleased.ok) outputArtifact = undefined;
        checks.released = decodedReleased.ok && sampledReleased.ok && outputReleased.ok && !new File(outputUri!).exists;
        timings.verification = now() - tick;

        const complete = Object.values(checks).every(value => value === true);
        const architectureReport: EditorMediaProbeReport | null = complete ? {
            version: 1, run, ingress: 'skia-rgba8-file-batches', firstProcessMethod: method, frameCount: 900, width: 1280, height: 720, fps: 30,
            timingsMs: { renderReadback: timings.renderReadback, fileWrite: timings.fileWrite, nativeAppendEncode: timings.nativeAppendEncode,
                finalize: timings.finalize, total: timings.total }, bytes,
            verification: { videoCodec: 'avc1', audioCodec: 'mp4a', durationUs: inspected.value.durationUs, audioVideoSkewUs, timestampToleranceUs: 1, colorTolerance: 12,
                cancelledClean: true, corruptClean: true, retryPassed: true, released: true },
        } : null;
        evidence = { schemaVersion: 1, status: architectureReport ? 'passed' : 'blocked', run, startedAt, completedAt: new Date().toISOString(), method,
            reportUri: reportFile.uri, archiveUri: archiveFile.uri, architectureReport, timingsMs: timings, bytes, checks, blockers };
    } catch (error) {
        if (signal?.aborted) blockers.push('probe-cancelled');
        evidence = { schemaVersion: 1, status: 'failed', run, startedAt, completedAt: new Date().toISOString(), method: diagnostic ? `${method}; ${diagnostic}` : method,
            reportUri: reportFile.uri, archiveUri: archiveFile.uri, architectureReport: null, timingsMs: timings, bytes, checks, blockers, failure: stableFailure(error) };
    } finally {
        if (activeSession) editorMedia.cancel(activeSession);
        remainingFrames.forEach(safeDelete); safeDelete(wav); safeDelete(rotated); safeDelete(corrupt);
        for (const artifact of [pcmArtifact, sampleArtifact, decodedOutputArtifact, outputArtifact, rotatedArtifact]) if (artifact) await editorMedia.release(S9_PROBE_PROJECT, artifact);
    }
    directory.create({ intermediates: true, idempotent: true }); const serialized = JSON.stringify(evidence, null, 2);
    await archiveFile.write(serialized); await reportFile.write(serialized);
    onStatus?.(`${evidence.status}: ${reportFile.uri}`); return evidence;
}
