import { randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { Inflate } from 'fflate';
// @ts-ignore shared environment-neutral random-access ZIP parser.
import * as beatZip from '../../../../../app/veyrnox/_lib/music/beat/beatZip.mjs';

const shared = beatZip as unknown as {
    ZIP_LIMIT: number;
    ZIP_READ_CHUNK: number;
    extractStemFromReader(reader: ZipReader, part: StemPart, inflate: InflateRaw): Promise<Uint8Array>;
    extractStemsFromReader(reader: ZipReader, inflate: InflateRaw): Promise<StemParts>;
};
type StemPart = 'vocals' | 'instrumental';
export type StemParts = Record<StemPart, Uint8Array>;
type ZipReader = { size: number; read(offset: number, length: number): Promise<Uint8Array> };
type CompressedSource = { next(): Promise<{ bytes: Uint8Array; final: boolean } | null> };
type InflateRaw = (source: CompressedSource, emit: (bytes: Uint8Array) => void) => Promise<void>;
type OpenReader = { reader: ZipReader; close(): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGE_MARKER = '.created';
export const NATIVE_INFLATE_INPUT_CHUNK = 16 * 1024;
// DEFLATE's maximum practical expansion is about 1032:1. A 16 KiB input push therefore caps
// one fflate callback below 17 MB, before the shared exact-size guard copies it.
export const NATIVE_INFLATE_OUTPUT_CHUNK_MAX = NATIVE_INFLATE_INPUT_CHUNK * 1032;
export const STEM_ZIP_LIMIT = shared.ZIP_LIMIT;
export const NATIVE_INFLATE_PEAK_BYTES = shared.ZIP_READ_CHUNK + NATIVE_INFLATE_OUTPUT_CHUNK_MAX;
const active = new Set<string>();
const root = () => new Directory(Paths.cache, 'veyrnox-beat-stem-runs');
const zipError = () => Object.assign(new Error('This stem archive has an unexpected layout'), { permanent: true });

export class NativeStemArchiveError extends Error {
    constructor(readonly reason: 'invalid_size' | 'size_changed' | 'transfer_failed', readonly status?: number) {
        super(`stem_archive_${reason}`);
        this.name = 'NativeStemArchiveError';
    }
}

function remove(directory: Directory) {
    try { if (directory.exists) directory.delete(); } catch { /* Cache cleanup is best effort. */ }
}

/** Delete every abandoned direct child attempt. Active attempts are the only exception. */
export function sweepStemArchiveRuns(): void {
    try {
        const staging = root(), prefix = `${staging.uri.replace(/\/$/, '')}/`;
        if (!staging.exists) return;
        for (const entry of staging.list()) {
            if (!(entry instanceof Directory) || active.has(entry.uri)) continue;
            const relative = entry.uri.startsWith(prefix) ? entry.uri.slice(prefix.length).replace(/\/$/, '') : '';
            if (!UUID.test(relative)) continue;
            try { remove(entry); } catch { /* One inaccessible attempt must not prevent sweeping the others. */ }
        }
    } catch { /* A missing or inaccessible cache must not prevent a future load. */ }
}

/** Open one seekable Expo handle. The caller must close it before deleting the containing run. */
export function openStemArchiveReader(file: File, check: () => void = () => {}): OpenReader {
    const handle: FileHandle = file.open(FileMode.ReadOnly);
    const size = handle.size;
    if (size === null || !Number.isSafeInteger(size) || size < 0) {
        handle.close();
        throw new NativeStemArchiveError('size_changed');
    }
    let closed = false;
    return {
        reader: {
            size,
            async read(offset, length) {
                check();
                if (closed) throw new Error('stem_archive_closed');
                handle.offset = offset;
                const bytes = await handle.readBytes(length);
                check();
                if (bytes.length !== length) throw zipError();
                return bytes;
            },
        },
        close() {
            if (closed) return;
            closed = true;
            handle.close();
        },
    };
}

export const inflateNativeStem: InflateRaw = async (source, emit) => {
    let finished = false;
    const inflater = new Inflate((chunk, final) => {
        emit(chunk);
        if (final) finished = true;
    });
    for (;;) {
        const item = await source.next();
        if (!item) break;
        const pushes = Math.max(1, Math.ceil(item.bytes.length / NATIVE_INFLATE_INPUT_CHUNK));
        for (let index = 0; index < pushes; index++) {
            const start = index * NATIVE_INFLATE_INPUT_CHUNK;
            const bytes = item.bytes.subarray(start, Math.min(item.bytes.length, start + NATIVE_INFLATE_INPUT_CHUNK));
            try { inflater.push(bytes, item.final && index === pushes - 1); }
            catch (error) { throw (error as { permanent?: boolean })?.permanent ? error : zipError(); }
            if (!(item.final && index === pushes - 1)) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }
    if (!finished) throw zipError();
};

type NativeStemArchiveInput = {
    url: string;
    sizeBytes: number;
    part: StemPart;
    signal?: AbortSignal;
    current?(): boolean;
};

function httpStatus(error: unknown): number | undefined {
    const match = /\b(?:HTTP|status(?::| is| was)?)\D*(401|403)\b/i.exec((error as Error)?.message ?? '');
    return match ? Number(match[1]) : undefined;
}

/** Serialize archive extraction so separate playback/AI surfaces cannot multiply its transient peak. */
let loadTail: Promise<unknown> = Promise.resolve();
export function loadNativeStemArchive(input: NativeStemArchiveInput): Promise<Uint8Array> {
    const task = loadNativeStemArchiveParts(input).then(parts => parts[input.part]);
    return task;
}

export function loadNativeStemArchiveParts(input: Omit<NativeStemArchiveInput, 'part'>): Promise<StemParts> {
    const task = loadTail.catch(() => undefined).then(() => loadNativeStemArchiveRun(input));
    loadTail = task;
    return task;
}

/** Download to an isolated cache run, range-read one stem, then remove every temporary byte. */
async function loadNativeStemArchiveRun({ url, sizeBytes, signal, current = () => true }: Omit<NativeStemArchiveInput, 'part'>): Promise<StemParts> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > shared.ZIP_LIMIT) throw new NativeStemArchiveError('invalid_size');
    sweepStemArchiveRuns();
    const check = () => {
        if (signal?.aborted) throw signal.reason ?? new Error('audio_load_cancelled');
        if (!current()) throw new Error('account_changed');
    };
    check();
    const attempt = new Directory(root(), randomUUID());
    const archive = new File(attempt, 'archive.zip');
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    let created = false, oversized = false, opened: OpenReader | undefined;
    active.add(attempt.uri);
    try {
        attempt.create({ intermediates: true }); created = true;
        const marker = new File(attempt, AGE_MARKER);
        marker.create(); marker.writeSync(String(Date.now()));
        try {
            await File.downloadFileAsync(url, archive, {
                idempotent: true,
                signal: controller.signal,
                onProgress(progress) {
                    if (progress.bytesWritten > sizeBytes || progress.totalBytes > sizeBytes) {
                        oversized = true; controller.abort('size_changed');
                    }
                },
            });
        } catch (error) {
            check();
            if (oversized) throw new NativeStemArchiveError('size_changed');
            throw new NativeStemArchiveError('transfer_failed', httpStatus(error));
        }
        check();
        if (archive.size !== sizeBytes) throw new NativeStemArchiveError('size_changed');
        opened = openStemArchiveReader(archive, check);
        if (opened.reader.size !== sizeBytes) throw new NativeStemArchiveError('size_changed');
        const bytes = await shared.extractStemsFromReader(opened.reader, inflateNativeStem);
        check();
        return bytes;
    } finally {
        try { opened?.close(); }
        finally {
            signal?.removeEventListener('abort', cancel);
            controller.abort();
            if (created) remove(attempt);
            active.delete(attempt.uri);
        }
    }
}
