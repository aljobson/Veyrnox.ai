import type { MusicActionQuoteBase } from './actionTypes';
export type TrackAddMode = 'vocals' | 'instrumental';
export type VocalGender = 'auto' | 'female' | 'male';
export type TrackAddState = 'queued' | 'running' | 'ready' | 'failed' | 'refunded';
export type TrackAddStage = 'source_upload' | 'part_generation' | 'complete';
export type TrackAddParameters = Readonly<{
    mode: TrackAddMode; prompt: string; lyrics: string; vocal_gender?: VocalGender; lyrics_rights_confirmed: boolean;
}>;
export type MusicTrackAddQuote = MusicActionQuoteBase & Readonly<{
    mode: TrackAddMode; source_duration_seconds: number; upload_credits: number; track_credits: number;
}>;
export type TrackAddStart = Readonly<{
    request_id: string; upload_job_id: string; track_job_id: string; state: TrackAddState;
    balance_after?: number; idempotent?: true;
}>;
export type TrackAddRequest = Readonly<{
    id: string; song_id: string; source_version_id: string; mode: TrackAddMode;
    upload_job_id: string; track_job_id: string; upload_credits: number; track_credits: number;
    created_at: string; state: TrackAddState; stage: TrackAddStage;
}>;
export type TrackAddAudio = Readonly<{ url: string; mime_type: 'audio/mpeg' | 'audio/wav'; size_bytes: number; expires_in: number }>;
