import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '../../src/lib/api';
import { createMetadataPort, loadResults, type AudioFiles } from '../../src/lib/beatAi/results';
import { probeAudioHeader, mp3Seconds } from '../../src/lib/beatAi/shared';
import { asset, doc, row, id } from './fixtures';
function wav(channels = 2) {
    const bytes = new Uint8Array(44 + 4800 * channels * 2), v = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
    text(0, 'RIFF'); v.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, 48000, true); v.setUint32(28, 48000 * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, bytes.length - 44, true); return bytes;
}
function setup(bytes: Uint8Array, total = bytes.length, signedSize: number | undefined = total) {
    const header = probeAudioHeader(bytes, bytes.length);
    const seconds = header.container === 'mp3' ? mp3Seconds(bytes, bytes.length)! : header.durationSec!;
    const file = { download: jest.fn(async () => undefined), size: jest.fn(() => bytes.length), bytes: jest.fn(async () => bytes), remove: jest.fn() };
    const files: AudioFiles = { prefix: jest.fn(async () => ({ bytes: bytes.slice(0, 65536), total })), temporary: () => file };
    const decoder = { decode: jest.fn(async () => ({ numberOfChannels: header.channels!, sampleRate: 48000, length: Math.round(seconds * 48000) })), close: jest.fn(async () => undefined) };
    const port = createMetadataPort({ sign: jest.fn(async () => ({ url: 'https://example.test/audio', size_bytes: signedSize })) }, files, () => decoder);
    return { file, decoder, port, files, seconds };
}
const item = { source: asset.source, ref: asset.ref, name: asset.name, bpm: null };
test('real WAV and MP3 bytes pass shared metadata scan before fake native decoder', async () => {
    const mp3 = new Uint8Array(readFileSync(join(__dirname, '../fixtures/beat-ai-silence.mp3')));
    for (const bytes of [wav(), mp3]) {
        const x = setup(bytes); const result = await x.port.load(item);
        expect(result.durationSec).toBeCloseTo(x.seconds); expect(result.sourceChannels).toBe(2);
        expect(x.decoder.decode).toHaveBeenCalledTimes(1); expect(x.decoder.close).toHaveBeenCalledTimes(1); expect(x.file.remove).toHaveBeenCalledTimes(1);
    }
});
test('unknown/oversize and bad channels are refused before full download or decode', async () => {
    for (const x of [setup(wav(), 0, undefined), setup(wav(), 120000001), setup(wav(3))]) {
        await expect(x.port.load(item)).rejects.toThrow(); expect(x.file.download).not.toHaveBeenCalled(); expect(x.decoder.decode).not.toHaveBeenCalled();
    }
});
test('file size mismatch and native failure clean up, and decoded channel drift is refused', async () => {
    const size = setup(wav()); size.file.size.mockReturnValue(1);
    await expect(size.port.load(item)).rejects.toThrow(); expect(size.file.bytes).not.toHaveBeenCalled(); expect(size.file.remove).toHaveBeenCalled();
    const decode = setup(wav()); decode.decoder.decode.mockRejectedValue(new Error('native'));
    await expect(decode.port.load(item)).rejects.toThrow('native'); expect(decode.decoder.close).toHaveBeenCalled(); expect(decode.file.remove).toHaveBeenCalled();
    const drift = setup(wav()); drift.decoder.decode.mockResolvedValue({ numberOfChannels: 3, sampleRate: 48000, length: 4800 });
    await expect(drift.port.load(item)).rejects.toThrow(); expect(drift.file.remove).toHaveBeenCalled();
});
test('held alternate is omitted; other errors keep the caller receipt; failed/refunded load no assets', async () => {
    const record = { ...row(), requestId: id(8) };
    const candidates = [1, 2].map(ordinal => ({ ordinal, state: 'succeeded', song_id: id(5), version_id: id(6), job_id: id(7) }));
    const load = jest.fn().mockRejectedValueOnce(new ApiError(404, '', { error: { code: 'held' } })).mockResolvedValueOnce(asset);
    const result = await loadResults(record, { state: 'partial', candidates }, doc(), { load });
    expect(result.messages).toEqual(['beatAi.heldA']); expect(result.results.map(r => r.ordinal)).toEqual([1]);
    load.mockRejectedValue(new ApiError(502, 'bad')); await expect(loadResults(record, { state: 'succeeded', candidates }, doc(), { load })).rejects.toThrow();
    load.mockClear();
    for (const state of ['failed', 'refunded']) expect((await loadResults(record, { state }, doc(), { load })).messages).toEqual(['beatAi.failed']);
    expect(load).not.toHaveBeenCalled();
});
test.each([{ candidates: undefined }, { candidates: [] }])('terminal success with no candidates returns the library note', async ({ candidates }) => {
    const load = jest.fn();
    expect(await loadResults(row(), { state: 'succeeded', candidates }, doc(), { load })).toEqual({ results: [], messages: ['beatAi.library'] });
    expect(load).not.toHaveBeenCalled();
});
