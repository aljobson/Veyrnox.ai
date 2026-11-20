import type { Playlist } from '../../src/lib/music/playlistTypes';
export const playlistId = '11111111-1111-4111-8111-111111111111';
export const songId = '22222222-2222-4222-8222-222222222222';
export const secondId = '33333333-3333-4333-8333-333333333333';
export const versionId = '44444444-4444-4444-8444-444444444444';
export const jobId = '55555555-5555-4555-8555-555555555555';
export const playlist: Playlist = { id: playlistId, title: 'Evening', pinned: false, revision: 3,
    created_at: '2026-11-19T14:00:00.123+00:00', songs: [
        { id: songId, title: 'First', version_id: versionId, audio_url: `/api/v1/jobs/${jobId}/asset`, position: 1 },
        { id: secondId, title: 'Second', version_id: versionId, audio_url: `/api/v1/jobs/${jobId}/asset`, position: 2 },
    ] };
export const created = { id: playlistId, title: 'Evening', pinned: false, revision: 0, songs: [] };
export function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { resolve, reject, promise };
}
