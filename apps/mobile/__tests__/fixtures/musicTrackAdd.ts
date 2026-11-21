import { actionSong, SONG_ID, VERSION_ID } from './musicActions';
import type { MusicTrackAddQuote, TrackAddStart, TrackAddRequest, TrackAddAudio, TrackAddParameters } from '../../src/lib/music/trackAddTypes';
export const trackSong = { ...actionSong, actions: ['add_track'] };
export const vocals: TrackAddParameters = { mode: 'vocals', prompt: '  warm harmonies  ', lyrics: '  Sing along  ', vocal_gender: 'auto', lyrics_rights_confirmed: true };
export const instrumental: TrackAddParameters = { mode: 'instrumental', prompt: '  warm piano  ', lyrics: '', vocal_gender: 'auto', lyrics_rights_confirmed: false };
export const trackQuote: MusicTrackAddQuote = { quote_id: '44444444-2222-4333-8444-555555555555', mode: 'vocals',
    source_duration_seconds: 93.25, upload_credits: 2, track_credits: 8, total_credits: 10,
    balance: 100, balance_after: 90, affordable: true, expires_at: '2099-01-01T00:00:00Z' };
export const trackStart: TrackAddStart = { request_id: '55555555-2222-4333-8444-555555555555',
    upload_job_id: '66666666-2222-4333-8444-555555555555', track_job_id: '77777777-2222-4333-8444-555555555555', state: 'queued', balance_after: 90 };
export const trackReplay: TrackAddStart = { request_id: trackStart.request_id, upload_job_id: trackStart.upload_job_id,
    track_job_id: trackStart.track_job_id, state: 'running', idempotent: true };
export const trackRequest: TrackAddRequest = { id: trackStart.request_id, song_id: SONG_ID, source_version_id: VERSION_ID,
    mode: 'vocals', upload_job_id: trackStart.upload_job_id, track_job_id: trackStart.track_job_id,
    upload_credits: 2, track_credits: 8, created_at: '2026-11-20T10:00:00Z', state: 'queued', stage: 'source_upload' };
export const trackReady: TrackAddRequest = { ...trackRequest, state: 'ready', stage: 'complete' };
export const trackFailed: TrackAddRequest = { ...trackRequest, state: 'failed', stage: 'part_generation' };
// These distinct ledger outcomes are deliberately indistinguishable in the public response.
export const uploadFailureRefund: TrackAddRequest = { ...trackRequest, state: 'refunded', stage: 'part_generation' };
export const partFailureRefund: TrackAddRequest = { ...trackRequest, state: 'refunded', stage: 'part_generation' };
export const trackAudio: TrackAddAudio = { url: 'https://mock.test/part.mp3', mime_type: 'audio/mpeg', size_bytes: 4096, expires_in: 300 };
