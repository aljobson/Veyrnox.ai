import { createMockContext } from './helpers/mockNativeAudio';
import type { NativeOfflineCtor, NativeOfflineContext } from '../src/lib/beatNative/nativeContext';
import type { ExportOptions, PCMBuffer } from '../src/lib/beatNative/exportShared';
export const exportOptions: ExportOptions = { kind: 'song', range: 'song', output: 'mix', bitDepth: 16, loops: 1 };
export function offlineFixture() {
    const contexts: NativeOfflineContext[] = [], rendered: PCMBuffer[] = [], starts = jest.fn();
    const buffer = (channels: number, length: number, sampleRate: number): PCMBuffer => {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return { numberOfChannels: channels, length, sampleRate, getChannelData: channel => data[channel] };
    };
    const Context = function (channels: number, length: number, sampleRate: number) {
        const context = { ...createMockContext().context, sampleRate, createBuffer: buffer,
            startRendering: async () => {
                starts(channels, length, sampleRate);
                const result = buffer(channels, length, sampleRate); rendered.push(result); return result;
            } };
        contexts.push(context); return context;
    } as unknown as NativeOfflineCtor;
    return { Context, contexts, rendered, starts };
}
