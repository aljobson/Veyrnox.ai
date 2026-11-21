import type { BeatAiClient } from './client';
import { uuid } from './client';
import { failure } from './errors';
import { admitScan, admitDecode, admitProbe, probeAudioHeader, mp3Seconds, checkDecoded, validAsset, isHeldError, placedAlready, type Decoded } from './shared';
import type { AiDoc, Asset, Pending, Result, Status } from './types';
export type AssetItem = Pick<Asset, 'source' | 'ref' | 'name' | 'bpm'>;
export interface AssetMetadataPort { load(item: AssetItem, signal?: AbortSignal): Promise<Asset> }
export interface AudioFiles {
    prefix(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; total: number }>;
    temporary(): { download(url: string): Promise<void>; size(): number; bytes(): Promise<Uint8Array>; remove(): void };
}
export interface Decoder { decode(bytes: ArrayBuffer): Promise<Decoded>; close(): Promise<void> }
// Serialize the entire scan/decode, so separate sheets cannot multiply the memory bound.
let tail: Promise<unknown> = Promise.resolve();
export function createMetadataPort(client: Pick<BeatAiClient, 'sign'>, files: AudioFiles, decoder: () => Decoder): AssetMetadataPort {
    return { load(item, signal) {
        const check = () => { if (signal?.aborted) throw new Error('aborted'); };
        const task = tail.catch(() => undefined).then(async () => {
            check();
            const signed = await client.sign(item); check();
            if (signed.size_bytes !== undefined) admitScan(signed.size_bytes);
            const prefix = await files.prefix(signed.url, signal); check();
            const size = admitScan(signed.size_bytes ?? prefix.total);
            if (prefix.total !== size || prefix.bytes.length > 65536) throw new Error('size_changed');
            let header = probeAudioHeader(prefix.bytes, size);
            if (!header.needsFullHeader) {
                admitProbe(header);
                if (header.durationSec !== null) admitDecode({ durationSec: header.durationSec, sourceChannels: header.channels!, encodedBytes: size });
            }
            const file = files.temporary();
            let context: Decoder | undefined;
            let bytes: Uint8Array | undefined;
            let buffer: Decoded | undefined;
            try {
                await file.download(signed.url); check();
                if (file.size() !== size) throw new Error('size_changed');
                bytes = await file.bytes(); check();
                if (bytes.length !== size || bytes.byteOffset !== 0 || bytes.buffer.byteLength !== size) throw new Error('size_changed');
                if (header.needsFullHeader) header = probeAudioHeader(bytes, size);
                admitProbe(header);
                const durationSec = header.container === 'mp3' ? mp3Seconds(bytes, size) : header.durationSec;
                const asset: Asset = { ...item, durationSec: durationSec ?? 0, sourceChannels: header.channels ?? 0, encodedBytes: size };
                admitDecode(asset);
                context = decoder();
                buffer = await context.decode(bytes.buffer as ArrayBuffer); check();
                checkDecoded(buffer, asset);
                if (!validAsset(asset, 120)) throw new Error('invalid_asset');
                return asset;
            } finally {
                buffer = undefined; bytes = undefined;
                try { await context?.close(); } finally { file.remove(); }
            }
        });
        tail = task;
        return task;
    } };
}
export async function loadResults(record: Pending, status: Status, doc: AiDoc, port: AssetMetadataPort, signal?: AbortSignal) {
    const results: Result[] = [], messages: string[] = [];
    if (['failed', 'refunded'].includes(status.state)) return { results, messages: ['beatAi.failed'] };
    if (record.op === 'stems') throw new Error('split_stems_web_only');
    const pair = record.op !== 'targetStems';
    if (pair && !status.candidates?.length) return { results, messages: ['beatAi.library'] };
    const candidates = pair ? status.candidates ?? [] : [{ ordinal: 1, state: 'ready' }, { ordinal: 2, state: 'ready' }];
    for (const c of candidates) {
        if (signal?.aborted) throw new Error('aborted');
        const ordinal = c.ordinal - 1, label = ordinal === 0 ? 'A' : 'B';
        if (['failed', 'refunded'].includes(c.state)) { messages.push(ordinal === 0 ? 'beatAi.failedA' : 'beatAi.failedB'); continue; }
        if (!['ready', 'succeeded', 'stored'].includes(c.state.toLowerCase())) continue;
        const name = pair ? `✦ ${record.prompt.slice(0, 24)} ${label}` : ordinal === 0 ? record.instrument! : `Without ${record.instrument}`;
        if (placedAlready(doc, record, ordinal)) { results.push({ ordinal, name, asset: doc.assets[record.placementIds[ordinal].asset] as Asset }); continue; }
        if (pair && ![c.song_id, c.version_id, c.job_id].every(uuid)) throw new Error('missing_result_ref');
        const ref: Record<string, string> = pair ? { songId: c.song_id!, versionId: c.version_id!, jobId: c.job_id! }
            : { songId: record.source!.songId, versionId: record.source!.versionId, requestId: record.requestId!, kind: ordinal === 0 ? 'target' : 'residual', instrument: record.instrument! };
        try {
            const asset = await port.load({ source: pair ? 'song' : 'target', ref, name, bpm: null }, signal);
            if (signal?.aborted) throw new Error('aborted');
            if (!validAsset(asset, doc.tempo.bpm)) throw new Error('invalid_asset');
            results.push({ ordinal, name, asset });
        } catch (error) {
            if (!isHeldError(failure(error))) throw error;
            messages.push(ordinal === 0 ? 'beatAi.heldA' : 'beatAi.heldB');
        }
    }
    return { results, messages };
}
