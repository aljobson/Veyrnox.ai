import { createBeat, type BeatDoc } from './doc';
import { addAudioRegion, type AudioAsset } from './labs';
import { createBeatRecord, type CreationStore } from './templates';
import { prepareRemoteSong, type DecodedAudio } from './remoteSong';
// @ts-ignore shared identifier validation
import * as document from '../../../../../app/veyrnox/_lib/music/beat/beatDocument.mjs';
export type { DecodedAudio } from './remoteSong';
export type SongSeedSong = { id: string; version_id: string; job_id: string; title: string };
export type SeedCode = 'r34' | 'r35' | 'r36' | 'r37' | 'unsupported';
export const seedFailure = (code: SeedCode) => Object.assign(new Error(code), { code });
export function seedErrorCode(error: unknown): SeedCode {
    const code = (error as { code?: string })?.code;
    return code === 'r34' || code === 'r35' || code === 'r36' || code === 'r37' || code === 'unsupported' ? code : 'unsupported';
}
export { fetchAudioAsset } from './remoteSong';
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
    let asset: AudioAsset;
    try {
        ({ asset } = await prepareRemoteSong({ ...song, title: song.title.trim() ? song.title : title }, { sign: deps.sign, fetchAudio: deps.fetchAudio, decode: deps.decode,
            current: () => !signal.aborted }, signal));
    } catch (error) {
        assertSeedActive(signal);
        let value: unknown = error, status: number | undefined, code: string | undefined;
        for (let depth = 0; depth < 4 && value && typeof value === 'object'; depth++) {
            const row = value as { status?: unknown; code?: unknown; cause?: unknown };
            if (status === undefined && typeof row.status === 'number') status = row.status;
            if (code === undefined && typeof row.code === 'string') code = row.code;
            value = row.cause;
        }
        if (status === 401 || code === 'account_changed' || code === 'not_authenticated') throw seedFailure('r36');
        if (status === 403 || status === 404 || status === 410 || code === 'held' || code === 'invalid_signed_url') throw seedFailure('r34');
        if (status === 0 || code === 'network' || (status !== undefined && status >= 500)) throw seedFailure('r35');
        throw seedFailure('unsupported');
    }
    assertSeedActive(signal);
    if (!userId || await deps.currentUserId() !== userId) throw seedFailure('r36');
    const loaded = asset;
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
