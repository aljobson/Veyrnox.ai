import type { MusicHook, MusicSongDetail } from '../../src/lib/music/types';
export const JOB = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
export const HOOK_JOB = '11111111-2222-4333-8444-555555555555';
export const version = { id: 'v1', version_number: 1, operation: 'generate', parent_version_id: null, created_at: '2026-11-18T10:00:00Z' };
export const song: MusicSongDetail = { id: 's1', title: 'A song', job_id: JOB, version_id: 'v1', audio_url: `/api/v1/jobs/${JOB}/asset`,
    current_version: version, versions: [{ ...version, is_current: true }], actions: ['share_link'], provenance: {} };
export const hook: MusicHook = { id: 'h1', song_id: 's1', song_title: 'A song', title: 'Hook', start_seconds: 4, end_seconds: 9,
    created_at: version.created_at, audio_url: `/api/v1/jobs/${HOOK_JOB}/asset` };
// Real 0468 projection: trash deliberately has no playable audio URL.
export const trashedRow = { id: 's1', title: 'A song', visibility: 'private', workspace_id: 'w1', workspace_name: 'My music',
    revision: 3, created_at: version.created_at, updated_at: version.created_at, version_id: 'v1', job_id: JOB,
    audio_url: null, status: 'ready', lifecycle_status: 'trashed', feedback: null };
export const link = { id: 'l1', version_id: 'v1', revoked_at: null, created_at: version.created_at };
