import { createBeat, type BeatDoc } from './doc';
import { addAudioRegion, type AudioAsset } from './labs';
import { createBeatRecord, type CreationStore } from './templates';
// @ts-ignore shared bounded streaming loader, including probe, frame count and checkDecoded
import * as audioFetch from '../../../../../app/veyrnox/_lib/music/beat/beatAudioFetch.mjs';
// @ts-ignore shared identifier validation
import * as document from '../../../../../app/veyrnox/_lib/music/beat/beatDocument.mjs';
export type DecodedAudio = { numberOfChannels: number; sampleRate: number; length: number };
export type SongSeedSong = { id: string; version_id: string; job_id: string; title: string };
export type SeedCode = 'r34' | 'r35' | 'r36' | 'r37' | 'unsupported';
export const seedFailure = (code: SeedCode) => Object.assign(new Error(code), { code });
export function seedErrorCode(error: unknown): SeedCode {
    const code = (error as { code?: string })?.code;
    return code === 'r34' || code === 'r35' || code === 'r36' || code === 'r37' || code === 'unsupported' ? code : 'unsupported';
}
export const fetchAudioAsset = (audioFetch as unknown as {
    fetchAudioAsset(url: string, base: Omit<AudioAsset, 'durationSec' | 'sourceChannels' | 'encodedBytes'>, stored: null,
        deps: { fetchAudio: typeof fetch; decode(bytes: ArrayBuffer): Promise<DecodedAudio> }): Promise<{ asset: AudioAsset; buffer: DecodedAudio }>;
}).fetchAudioAsset;
export type SeedDeps = {
    online(): boolean | Promise<boolean>; currentUserId(): string | null | Promise<string | null>;
    getSong(id: string, signal: AbortSignal): Promise<SongSeedSong>;
    sign(jobId: string, signal: AbortSignal): Promise<{ url: string }>;
    fetchAudio: typeof fetch; decode(bytes: ArrayBuffer): Promise<DecodedAudio>;
    store: CreationStore; fallbackTitle: string; ready?(): Promise<void>;
};
export function assertSeedActive(signal: AbortSignal) {
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
}
export async function seedSongBeat(deps: SeedDeps, songId: string, signal: AbortSignal): Promise<string> {
    assertSeedActive(signal);
    if (!await deps.online()) throw seedFailure('r35');
    if (!(document as { validBeatId(id: unknown): boolean }).validBeatId(songId)) throw seedFailure('r34');
    const userId = await deps.currentUserId();
    let song: SongSeedSong;
    try { song = await deps.getSong(songId, signal); }
    catch (error) {
        assertSeedActive(signal);
        const status = (error as { status?: number })?.status;
        throw seedFailure(status === 401 ? 'r36' : status === 403 || status === 404 ? 'r34' : 'r35');
    }
    const title = song.title.normalize('NFKC').trim().slice(0, 80) || deps.fallbackTitle;
    let asset: AudioAsset | undefined;
    // A private signed link may expire between signing and fetching, just as on web.
    for (let attempt = 0; attempt < 2; attempt++) {
        // Classify failures at the transport boundary, never by human-readable error text.
        // Probe, size, duration and decode failures remain unsupported audio, not offline.
        let transportFailed = false;
        async function transport<T>(operation: () => Promise<T>): Promise<T> {
            try { return await operation(); }
            catch (error) { assertSeedActive(signal); transportFailed = true; throw error; }
        }
        try {
            assertSeedActive(signal);
            const signed = await transport(() => deps.sign(song.job_id, signal));
            if (!signed?.url) throw seedFailure('r34');
            ({ asset } = await fetchAudioAsset(signed.url, { source: 'song', ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id },
                name: song.title.trim() ? song.title.slice(0, 80) : title, bpm: null }, null, {
                fetchAudio: async (url, options) => {
                    assertSeedActive(signal);
                    const response = await transport(() => deps.fetchAudio(url, { ...options, signal }));
                    const body = response.body;
                    // fetchAudioAsset uses only this response surface. Preserve streaming and cancellation;
                    // mark a rejected stream read as transport failure without catching validation errors.
                    return { ok: response.ok, status: response.status, headers: response.headers,
                        body: body && { cancel: () => body.cancel(), getReader() {
                            const reader = body.getReader();
                            return { read: () => transport(() => reader.read()), cancel: () => reader.cancel(), releaseLock: () => reader.releaseLock?.() };
                        } },
                    } as unknown as Response;
                },
                decode: bytes => { assertSeedActive(signal); return deps.decode(bytes); },
            }));
            break;
        } catch (error) {
            assertSeedActive(signal);
            const status = (error as { status?: number })?.status;
            if (attempt === 0 && (status === 401 || status === 403)) continue;
            if (status === 401) throw seedFailure('r36');
            if (status === 403 || status === 404 || status === 410) throw seedFailure('r34');
            throw seedFailure(transportFailed || status === 0 || (status !== undefined && status >= 500) ? 'r35' : seedErrorCode(error));
        }
    }
    assertSeedActive(signal);
    if (!userId || await deps.currentUserId() !== userId) throw seedFailure('r36');
    const loaded = asset!;
    let doc: BeatDoc;
    try {
        await deps.ready?.();
        assertSeedActive(signal);
        if (await deps.currentUserId() !== userId) throw seedFailure('r36');
        doc = await createBeatRecord(deps.store, title, initial => {
            const blank = createBeat({ id: initial.id, title, now: initial.createdAt });
            // BeatDoc's original seam describes drum tracks; the shared op validates this audio track.
            blank.tracks = [{ id: 't1', name: loaded.name.slice(0, 40), kind: 'audio', mute: false, solo: false, gain: 1, pan: 0, regions: [] }] as unknown as BeatDoc['tracks'];
            return addAudioRegion(blank, loaded, 't1', 0);
        }, () => assertSeedActive(signal));
    } catch (error) {
        assertSeedActive(signal);
        if (seedErrorCode(error) === 'r36') throw error;
        throw seedFailure('r37');
    }
    try {
        if (await deps.currentUserId() !== userId) throw seedFailure('r36');
        assertSeedActive(signal);
    } catch (error) {
        deps.store.dropBeat(doc.id); await deps.store.flushBeat(doc.id).catch(() => undefined); throw error;
    }
    return doc.id;
}
/** An effect replay shares the task. Real unmount aborts after the replay's synchronous reacquire window. */
export function createSeedSession(deps: SeedDeps, songId: string) {
    const controller = new AbortController();
    let pending: Promise<string> | undefined, subscribers = 0;
    return {
        acquire() { subscribers++; return pending ??= seedSongBeat(deps, songId, controller.signal); },
        release() { subscribers--; queueMicrotask(() => { if (subscribers === 0) controller.abort(); }); },
        abort() { controller.abort(); },
    };
}
