import { Directory, File, Paths } from 'expo-file-system';
import { framesIn, type Timeline } from './nativeEditorModel';
import type { PcmArtifact } from './editorMedia/protocol';

type NativeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

export type WavArtifact = {
    readonly artifactId: string;
    readonly uri: string;
    readonly kind: 'wav';
    readonly size: number;
    readonly sampleRate: 48000;
    readonly channels: 1 | 2;
    readonly frames: number;
    readonly durationUs: number;
    readonly audioCodec: 'pcm-s16le';
};

export type EditorAudioExportResult = { readonly ok: true; readonly artifact: WavArtifact }
    | { readonly ok: false; readonly code: 'cancelled' | 'invalid-timeline' | 'native-media' | 'write-failed'; readonly nativeCode?: string };

export type EditorAudioExportDependencies = {
    prepareAudio(timeline: Timeline, signal: AbortSignal, progress: (value: number) => void): Promise<NativeResult<PcmArtifact>>;
    read(uri: string): Promise<Uint8Array>;
    write(bytes: Uint8Array): Promise<{ uri: string; size: number }>;
    release(artifactId: string): Promise<void>;
};

export type EditorAudioExportRequest = {
    readonly timeline: Timeline;
    readonly signal?: AbortSignal;
    readonly onProgress?: (value: number) => void;
};

const ascii = (view: DataView, offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

/** Converts the native canonical 48 kHz float spool into a portable PCM16 WAV. */
export function encodePcm16Wave(source: Uint8Array, channels: 1 | 2, sampleRate: 48000): Uint8Array {
    if (source.byteLength === 0 || source.byteLength % (channels * 4) !== 0) throw Error('corrupt-pcm');
    const samples = source.byteLength / 4, output = new Uint8Array(44 + samples * 2);
    const input = new DataView(source.buffer, source.byteOffset, source.byteLength), view = new DataView(output.buffer);
    ascii(view, 0, 'RIFF'); view.setUint32(4, output.byteLength - 8, true); ascii(view, 8, 'WAVE');
    ascii(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    ascii(view, 36, 'data'); view.setUint32(40, samples * 2, true);
    for (let index = 0; index < samples; index += 1) {
        const sample = Math.max(-1, Math.min(1, input.getFloat32(index * 4, true)));
        view.setInt16(44 + index * 2, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
    }
    return output;
}

export async function exportEditorWav(request: EditorAudioExportRequest, dependencies: EditorAudioExportDependencies): Promise<EditorAudioExportResult> {
    const durationFrames = framesIn(request.timeline);
    if (!Number.isSafeInteger(request.timeline.fps) || request.timeline.fps < 1 || request.timeline.fps > 60 || durationFrames < 1
        || durationFrames > request.timeline.fps * 30) return { ok: false, code: 'invalid-timeline' };
    if (request.signal?.aborted) return { ok: false, code: 'cancelled' };
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, { once: true });
    let artifact: PcmArtifact | null = null;
    try {
        request.onProgress?.(0);
        const prepared = await dependencies.prepareAudio(request.timeline, controller.signal,
            value => request.onProgress?.(Math.max(0, Math.min(.7, value * .7))));
        if (!prepared.ok) return prepared.code === 'cancelled' ? { ok: false, code: 'cancelled' }
            : { ok: false, code: 'native-media', nativeCode: prepared.code };
        artifact = prepared.value;
        if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
        const pcm = await dependencies.read(artifact.uri);
        if (controller.signal.aborted) return { ok: false, code: 'cancelled' };
        if (pcm.byteLength !== artifact.size || artifact.frames * artifact.channels * 4 !== pcm.byteLength) return { ok: false, code: 'write-failed' };
        request.onProgress?.(.8);
        let wave: Uint8Array;
        try { wave = encodePcm16Wave(pcm, artifact.channels, artifact.sampleRate); }
        catch { return { ok: false, code: 'write-failed' }; }
        const written = await dependencies.write(wave);
        if (controller.signal.aborted) {
            try { new File(written.uri).delete(); } catch { /* Best-effort cancellation cleanup. */ }
            return { ok: false, code: 'cancelled' };
        }
        request.onProgress?.(1);
        return { ok: true, artifact: { artifactId: `wav-${Date.now().toString(36)}`, uri: written.uri, kind: 'wav', size: written.size,
            sampleRate: 48000, channels: artifact.channels, frames: artifact.frames,
            durationUs: Math.round(artifact.frames * 1_000_000 / 48000), audioCodec: 'pcm-s16le' } };
    } catch {
        return { ok: false, code: controller.signal.aborted ? 'cancelled' : 'write-failed' };
    } finally {
        request.signal?.removeEventListener('abort', abort);
        if (artifact) await dependencies.release(artifact.artifactId).catch(() => undefined);
    }
}

export const createAudioExportFileDependencies = (): Pick<EditorAudioExportDependencies, 'read' | 'write'> => ({
    read: uri => new File(uri).bytes(),
    async write(bytes) {
        const directory = new Directory(Paths.cache, 'veyrnox-editor-exports');
        directory.create({ idempotent: true, intermediates: true });
        const file = new File(directory, `audio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.wav`);
        file.create({ overwrite: false }); await file.write(bytes);
        return { uri: file.uri, size: file.size ?? bytes.byteLength };
    },
});

export function releaseWavArtifact(artifact: WavArtifact) {
    try { const file = new File(artifact.uri); if (file.exists) file.delete(); } catch { /* Cache sweep is the final guard. */ }
}
