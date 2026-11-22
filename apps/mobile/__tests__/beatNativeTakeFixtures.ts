import type { TakeFileIO } from '../src/lib/beatNative/takeFiles';
import type { Capture, CaptureChunk, AudioTake } from '../src/lib/beatNative/takeShared';
import type { PlaybackContext } from '../src/lib/beatNative/takePlayback';
export function takeIO() {
    const data = new Map<string, Uint8Array>(); let operations = 0, failAt = Infinity;
    const step = () => { if (++operations === failAt) throw new Error('interrupted'); };
    const io: TakeFileIO = {
        list: async () => [...data.keys()], read: async name => data.get(name)?.slice() ?? null,
        write: async (name, bytes) => { step(); data.set(name, bytes.slice()); },
        move: async (from, to) => { step(); if (!data.has(from)) throw new Error('missing'); data.set(to, data.get(from)!); data.delete(from); },
    };
    return { ...io, data, interrupt: (n: number) => { operations = 0; failAt = n; }, resume: () => { failAt = Infinity; } };
}
export const takeRow = (id = 'take-1', beatId = '33333333-3333-4333-8333-333333333333'): AudioTake => ({
    id, beatId, label: 'Take', sampleRate: 1000, length: 1000, samples: new Float32Array(1000).fill(0.25), createdAt: 1, state: 'pending',
    pending: { beatId, trackId: 't2', start: 0, length: 1920, pass: 0, recordingId: 'recording-1', cycle: false },
});
export function fakeContext() {
    const param = () => ({ value: 1, setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() });
    const node = () => ({ connect: jest.fn(), disconnect: jest.fn() });
    const sources: any[] = [];
    const context = { currentTime: 0, sampleRate: 1000, state: 'running', destination: {}, resume: async () => {}, close: async () => {},
        createBuffer: (channels: number, length: number, sampleRate: number) => {
            const samples = Array.from({ length: channels }, () => new Float32Array(length));
            return { length, numberOfChannels: channels, sampleRate, getChannelData: (channel: number) => samples[channel] };
        },
        decodeAudioData: jest.fn(),
        createBufferSource: () => { const source = { ...node(), buffer: null, start: jest.fn(), stop: jest.fn(), onended: null }; sources.push(source); return source; },
        createGain: () => ({ ...node(), gain: param() }), createStereoPanner: () => ({ ...node(), pan: param() }),
    } as unknown as PlaybackContext;
    return { context, sources };
}
export function fakeCapture(context = fakeContext().context) {
    const listeners = new Set<(chunk: CaptureChunk) => void>(); let ended = false, frame = -Infinity;
    const capture: Capture = { context, deviceId: 'default', get ended() { return ended; }, get capturedFrame() { return frame; },
        close: async () => { ended = true; }, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
    return { capture, send(chunk: CaptureChunk) { frame = chunk.frame + chunk.samples.length; context.currentTime = frame / context.sampleRate; listeners.forEach(fn => fn(chunk)); } };
}
