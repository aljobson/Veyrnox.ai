import type { MusicActionQuote, StemStart, StemRequest, StemArchive, CropResult } from '../../src/lib/music/actionTypes';
import type { MusicSongDetail } from '../../src/lib/music/types';
import { song, JOB } from './music';
export const SONG_ID = '11111111-2222-4333-8444-555555555555';
export const VERSION_ID = '22222222-2222-4333-8444-555555555555';
export const NEXT_VERSION_ID = '33333333-2222-4333-8444-555555555555';
export const actionSong: MusicSongDetail = { ...song, id: SONG_ID, version_id: VERSION_ID, revision: 1,
    lifecycle_status: 'active', actions: ['stems', 'crop'], current_version: { ...song.current_version, id: VERSION_ID },
    versions: [{ ...song.current_version, id: VERSION_ID, is_current: true }] };
export const actionQuote: MusicActionQuote = { quote_id: '44444444-2222-4333-8444-555555555555', model_id: 'stem-model',
    total_credits: 5, balance: 100, balance_after: 95, affordable: true, expires_at: '2099-01-01T00:00:00Z', outputs: ['vocals', 'instrumental'] };
export const stemStart: StemStart = { request_id: '55555555-2222-4333-8444-555555555555', job_id: JOB,
    state: 'queued', balance_after: 95, idempotent: true };
export const stemReplay: StemStart = { request_id: stemStart.request_id, job_id: JOB, state: 'queued', idempotent: true };
export const stemRequest: StemRequest = { id: stemStart.request_id, song_id: SONG_ID, source_version_id: VERSION_ID,
    job_id: JOB, model_id: 'stem-model', credits: 5, created_at: '2026-11-18T10:00:00Z', state: 'queued', archive_url: null };
export const stemArchive: StemArchive = { url: 'https://mock.test/private-archive.zip', mime_type: 'application/zip', size_bytes: 4096, expires_in: 300 };
export const cropResult: CropResult = { version_id: NEXT_VERSION_ID, version_number: 2, render_state: 'canonical', format: 'wav', idempotent: false };
export const croppedSong: MusicSongDetail = { ...actionSong, version_id: NEXT_VERSION_ID,
    current_version: { ...actionSong.current_version, id: NEXT_VERSION_ID, version_number: 2, operation: 'crop', parent_version_id: VERSION_ID },
    versions: [{ ...actionSong.current_version, is_current: false }, { ...actionSong.current_version,
        id: NEXT_VERSION_ID, version_number: 2, operation: 'crop', parent_version_id: VERSION_ID, is_current: true }] };
export const actionInput = { song_id: SONG_ID, version_id: VERSION_ID, rights_confirmed: true };
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
