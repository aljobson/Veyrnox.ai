import { File, Paths } from 'expo-file-system';
import { loadNativeContext } from '../beatNative/nativeContext';
import { newId } from '../beatNative/store';
import { createMetadataPort, type AudioFiles, type Decoder } from './results';
import type { BeatAiClient } from './client';
import { admitDecode, admitProbe, admitScan, checkDecoded, mp3Seconds, probeAudioHeader, validAsset } from './shared';
import { loadNativeStemArchiveParts, type StemParts } from '../beatNative/stemArchive';
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
const createDecoder = (): Decoder => {
    const Context = loadNativeContext();
    const context = new Context({ sampleRate: 48000 }) as unknown as { decodeAudioData(bytes: ArrayBuffer): ReturnType<Decoder['decode']>; close(): Promise<void> };
    return { decode: (bytes: ArrayBuffer) => context.decodeAudioData(bytes), close: () => context.close() };
};
type NativeMetadataDeps = {
    loadStemParts: typeof loadNativeStemArchiveParts;
    createDecoder: typeof createDecoder;
    validAsset: typeof validAsset;
};
export const nativeMetadata = (client: BeatAiClient,
    scope: { current(): boolean; bpm(): number } = { current: () => true, bpm: () => 120 }, injected: Partial<NativeMetadataDeps> = {}) => {
    const deps: NativeMetadataDeps = { loadStemParts: loadNativeStemArchiveParts, createDecoder, validAsset, ...injected };
    const archives = new Map<string, { pending: Promise<StemParts>; delivered: Set<string> }>();
    return createMetadataPort(client, files, deps.createDecoder, {
        async load(signed, item, signal) {
            const check = () => {
                if (signal?.aborted) throw signal.reason ?? new Error('aborted');
                if (!scope.current()) throw new Error('account_changed');
            };
            check();
            const archiveSize = admitScan(signed.size_bytes ?? 0);
            const part = item.ref.part;
            if (!['vocals', 'instrumental'].includes(part)) throw new Error('invalid_asset');
            let bytes: Uint8Array | undefined, context: Decoder | undefined;
            try {
                const requestId = item.ref.requestId;
                if (typeof requestId !== 'string') throw new Error('invalid_asset');
                let run = archives.get(requestId);
                if (!run) {
                    const pending = deps.loadStemParts({ url: signed.url, sizeBytes: archiveSize, signal, current: scope.current })
                        .catch(error => { archives.delete(requestId); throw error; });
                    run = { pending, delivered: new Set() }; archives.set(requestId, run);
                }
                bytes = (await run.pending)[part as 'vocals' | 'instrumental']; check();
                run.delivered.add(part);
                if (run.delivered.size === 2) archives.delete(requestId);
                const size = admitScan(bytes.length), header = probeAudioHeader(bytes, size);
                admitProbe(header);
                const durationSec = header.container === 'mp3' ? mp3Seconds(bytes, size) : header.durationSec;
                const asset = { ...item, durationSec: durationSec ?? 0, sourceChannels: header.channels ?? 0, encodedBytes: size };
                admitDecode(asset);
                context = deps.createDecoder();
                const decoded = await context.decode(bytes.buffer as ArrayBuffer); check();
                checkDecoded(decoded, asset);
                if (!deps.validAsset(asset, scope.bpm())) throw new Error('invalid_asset');
                return asset;
            } finally {
                bytes = undefined;
                await context?.close();
            }
        },
    });
};
