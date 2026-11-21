import { File, Paths } from 'expo-file-system';
import { loadNativeContext } from '../beatNative/nativeContext';
import { newId } from '../beatNative/store';
import { createMetadataPort, type AudioFiles, type Decoder } from './results';
import type { BeatAiClient } from './client';
import { admitScan } from './shared';
const files: AudioFiles = {
    async prefix(url, signal) {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        signal?.addEventListener('abort', cancel);
        if (signal?.aborted) abort.abort();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            const { fetch: streamFetch } = await import('expo/fetch');
            if (signal?.aborted) throw new Error('aborted');
            const response = await streamFetch(url, { headers: { Range: 'bytes=0-65535' }, signal: abort.signal });
            const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
            if (response.status !== 206 || !range || Number(range[1]) >= 65536) throw new Error('unknown_size');
            const total = admitScan(Number(range[2]));
            const expected = Math.min(total, 65536);
            if (Number(range[1]) + 1 !== expected) throw new Error('invalid_range');
            reader = response.body?.getReader();
            if (!reader) throw new Error('missing_body');
            const bytes = new Uint8Array(expected);
            let offset = 0;
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                if (offset + chunk.value.length > expected) throw new Error('invalid_range');
                bytes.set(chunk.value, offset); offset += chunk.value.length;
            }
            if (offset !== expected) throw new Error('truncated_header');
            return { bytes, total };
        } finally { abort.abort(); await reader?.cancel().catch(() => undefined); signal?.removeEventListener('abort', cancel); }
    },
    temporary() {
        const file = new File(Paths.cache, `beat-ai-${newId()}.audio`);
        return {
            async download(url) { await File.downloadFileAsync(url, file); },
            size: () => file.size,
            bytes: () => file.bytes(),
            remove: () => { if (file.exists) file.delete(); },
        };
    },
};
export const nativeMetadata = (client: BeatAiClient) => createMetadataPort(client, files, () => {
    const Context = loadNativeContext();
    const context = new Context({ sampleRate: 48000 }) as unknown as { decodeAudioData(bytes: ArrayBuffer): ReturnType<Decoder['decode']>; close(): Promise<void> };
    return { decode: bytes => context.decodeAudioData(bytes), close: () => context.close() };
});
