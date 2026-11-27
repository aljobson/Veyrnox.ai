import { encodePcm16Wave, exportEditorWav, type EditorAudioExportDependencies } from '../src/lib/editorAudioExport';
import type { PcmArtifact } from '../src/lib/editorMedia/protocol';
import { webSequenceV3 } from './fixtures/webSequenceV3';

const pcm = (samples: readonly number[], channels: 1 | 2 = 2): { artifact: PcmArtifact; bytes: Uint8Array } => {
    const bytes = new Uint8Array(samples.length * 4), view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setFloat32(index * 4, sample, true));
    return { bytes, artifact: { artifactId: 'mixed-audio', uri: 'file:///mixed.pcm', kind: 'pcm', size: bytes.length,
        sampleRate: 48000, channels, frames: samples.length / channels, encoding: 'f32le-interleaved' } };
};

test('wraps the canonical float mix as a standards-compliant 16-bit PCM WAV', () => {
    const result = encodePcm16Wave(pcm([-1, -.5, 0, .5, 1], 1).bytes, 1, 48000);
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    expect(new TextDecoder().decode(result.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(result.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(-16384);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(16384);
    expect(view.getInt16(52, true)).toBe(32767);
});

test('exports, validates and releases the transient mixed-audio spool', async () => {
    const source = pcm([-.25, .25, -.5, .5]);
    const released: string[] = [], written: Uint8Array[] = [];
    const dependencies: EditorAudioExportDependencies = {
        prepareAudio: jest.fn(async () => ({ ok: true as const, value: source.artifact })),
        read: jest.fn(async () => source.bytes),
        write: jest.fn(async bytes => { written.push(bytes); return { uri: 'file:///finished.wav', size: bytes.length }; }),
        release: async id => { released.push(id); },
    };
    const result = await exportEditorWav({ timeline: webSequenceV3() }, dependencies);
    expect(result).toEqual({ ok: true, artifact: expect.objectContaining({ kind: 'wav', uri: 'file:///finished.wav',
        sampleRate: 48000, channels: 2, frames: 2, durationUs: 42 }) });
    expect(written[0].length).toBe(52);
    expect(released).toEqual(['mixed-audio']);
});

test('rejects corrupt PCM and honours cancellation without retaining the spool', async () => {
    const source = pcm([0, 0]);
    const released: string[] = [], controller = new AbortController();
    const dependencies: EditorAudioExportDependencies = {
        prepareAudio: jest.fn(async () => { controller.abort(); return { ok: true as const, value: source.artifact }; }),
        read: jest.fn(async () => source.bytes),
        write: jest.fn(async () => ({ uri: 'file:///should-not-exist.wav', size: 1 })),
        release: async id => { released.push(id); },
    };
    await expect(exportEditorWav({ timeline: webSequenceV3(), signal: controller.signal }, dependencies))
        .resolves.toEqual({ ok: false, code: 'cancelled' });
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.write).not.toHaveBeenCalled();
    expect(released).toEqual(['mixed-audio']);
});
