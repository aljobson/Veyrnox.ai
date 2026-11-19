import type { MusicTargetStemQuote, TargetStemStart, TargetStemRequest, TargetStemAsset } from '../../src/lib/music/targetStemTypes';
import { actionSong, actionQuote, stemStart, stemRequest } from './musicActions';
export const targetSong = { ...actionSong, actions: ['target_stem'] };
export const targetQuote: MusicTargetStemQuote = { ...actionQuote, model_id: 'sam-audio-target-stem', instrument: 'guitar',
    source_duration_seconds: 93.25, total_credits: 4, balance_after: 96, outputs: ['target', 'residual'] };
export const targetStart: TargetStemStart = { request_id: stemStart.request_id, job_id: stemStart.job_id, state: 'queued', balance_after: 96 };
export const targetReplay: TargetStemStart = { request_id: targetStart.request_id, job_id: targetStart.job_id, state: 'queued', idempotent: true };
export const targetRequest: TargetStemRequest = { id: targetStart.request_id, song_id: targetSong.id, source_version_id: targetSong.version_id,
    job_id: targetStart.job_id, model_id: targetQuote.model_id, instrument: 'guitar', credits: 4,
    created_at: stemRequest.created_at, state: 'queued', outputs: [] };
export const targetAsset: TargetStemAsset = { url: 'https://mock.test/private-guitar.wav', mime_type: 'audio/wav', size_bytes: 4096, expires_in: 300, kind: 'target' };
export const residualAsset: TargetStemAsset = { ...targetAsset, url: 'https://mock.test/private-without-guitar.wav', kind: 'residual' };
