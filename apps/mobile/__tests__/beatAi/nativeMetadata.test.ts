jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'file:///cache' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
jest.mock('../../src/lib/beatNative/nativeContext', () => ({ loadNativeContext: jest.fn() }));

import { nativeMetadata } from '../../src/lib/beatAi/nativeMetadata';
import type { BeatAiClient } from '../../src/lib/beatAi/client';
import { id } from './fixtures';

function wav() {
    const bytes = new Uint8Array(44 + 4800 * 2 * 2), view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true); view.setUint32(28, 48000 * 4, true);
    view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
    return bytes;
}
const stem = (part: 'vocals' | 'instrumental') => ({ source: 'stem' as const,
    ref: { songId: id(5), versionId: id(6), requestId: id(8), part }, name: part, bpm: null });
const client = () => ({ sign: jest.fn(async () => ({ url: 'https://audio.test/stems.zip', size_bytes: 456 })) }) as unknown as BeatAiClient;
const decoder = () => ({ decode: jest.fn(async () => ({ numberOfChannels: 2, sampleRate: 48000, length: 4800 })), close: jest.fn(async () => {}) });

test('native metadata shares one owner-generation archive run, fences it, and validates with document tempo', async () => {
    const bytes = wav(), current = jest.fn(() => true), bpm = jest.fn(() => 137), validate = jest.fn((_asset: unknown, _tempo: number) => true);
    const loadStemParts = jest.fn(async () => ({ vocals: bytes, instrumental: bytes })), createDecoder = jest.fn(decoder);
    const port = nativeMetadata(client(), { current, bpm }, { loadStemParts, createDecoder, validAsset: validate });
    const signal = new AbortController().signal;
    await expect(port.load(stem('vocals'), signal)).resolves.toMatchObject({ durationSec: 0.1, sourceChannels: 2 });
    await expect(port.load(stem('instrumental'), signal)).resolves.toMatchObject({ durationSec: 0.1, sourceChannels: 2 });
    expect(loadStemParts).toHaveBeenCalledTimes(1);
    expect(loadStemParts).toHaveBeenCalledWith({ url: 'https://audio.test/stems.zip', sizeBytes: 456, signal, current });
    expect(validate.mock.calls.map(([, tempo]) => tempo)).toEqual([137, 137]);
    expect(createDecoder).toHaveBeenCalledTimes(2);
    await port.load(stem('vocals'), signal);
    expect(loadStemParts).toHaveBeenCalledTimes(2);
});

test('native metadata rejects an account replacement while the archive load is pending', async () => {
    const bytes = wav(); let live = true, resolve!: (parts: { vocals: Uint8Array; instrumental: Uint8Array }) => void;
    const pending = new Promise<{ vocals: Uint8Array; instrumental: Uint8Array }>(done => { resolve = done; });
    const port = nativeMetadata(client(), { current: () => live, bpm: () => 120 }, {
        loadStemParts: jest.fn(() => pending), createDecoder: decoder, validAsset: () => true,
    });
    const work = port.load(stem('vocals'));
    await Promise.resolve(); await Promise.resolve();
    live = false; resolve({ vocals: bytes, instrumental: bytes });
    await expect(work).rejects.toThrow('account_changed');
});

test('native metadata propagates the caller abort signal after a pending archive load', async () => {
    const bytes = wav(), controller = new AbortController();
    let resolve!: (parts: { vocals: Uint8Array; instrumental: Uint8Array }) => void;
    const pending = new Promise<{ vocals: Uint8Array; instrumental: Uint8Array }>(done => { resolve = done; });
    const port = nativeMetadata(client(), { current: () => true, bpm: () => 120 }, {
        loadStemParts: jest.fn(() => pending), createDecoder: decoder, validAsset: () => true,
    });
    const work = port.load(stem('vocals'), controller.signal), reason = new Error('superseded');
    await Promise.resolve(); await Promise.resolve();
    controller.abort(reason); resolve({ vocals: bytes, instrumental: bytes });
    await expect(work).rejects.toThrow('aborted');
});
