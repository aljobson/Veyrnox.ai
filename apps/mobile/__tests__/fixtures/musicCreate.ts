import type { MusicDraft, MusicEntitlements, MusicGeneration, MusicGenerationView, MusicInputSnapshot, MusicQuote } from '../../src/lib/music/types';
import { JOB, HOOK_JOB } from './music';
export const controls = { description: true, seed: false, variety: false, style_influence: false, exclude_styles: false, tempo_key_meter: false,
    duration_seconds: { min: 10, max: 60, default: 60 }, lyrics: false, styles: false, instrumental: 'required' as const };
export const entitlements: MusicEntitlements = { available: true, mode: 'simple', output_count: 2, concurrency_limit: 4, balance: 100, free_credits: 0, free_expires_at: null,
    models: [{ id: 'ace-step', name: 'ACE-Step', generation_modes: ['simple'], controls, credits_per_candidate: 5, total_credits: 10, instrumental_only: true, requires_paid_plan: false, available: true },
        { id: 'ace-step-1.5', name: 'ACE-Step 1.5', generation_modes: ['simple', 'custom'], controls: { ...controls, lyrics: true, styles: true, instrumental: 'optional' },
            credits_per_candidate: 10, total_credits: 20, instrumental_only: false, requires_paid_plan: true, available: true }],
    custom_drafts: { available: true, autosave: true, generation_supported: true, lyrics_max: 3000, styles_max: 500, title_max: 80 }, policy: { version: 'music-v1', pre_debit: true } };
export const quote: MusicQuote = { quote_id: JOB, mode: 'simple', model_id: 'ace-step', output_count: 2, credits_per_candidate: 5, total_credits: 10,
    balance: 100, balance_after: 90, affordable: true, expires_at: '2099-01-01T00:00:00Z', policy_version: 'music-v1' };
export const generation: MusicGeneration = { generation_id: HOOK_JOB, state: 'queued', balance_after: 90,
    candidates: [{ ordinal: 1, label: 'A', job_id: JOB, state: 'queued' }, { ordinal: 2, label: 'B', job_id: HOOK_JOB, state: 'queued' }] };
export const view: MusicGenerationView = { id: HOOK_JOB, state: 'running', model_id: 'ace-step', prompt: 'ambient music', title: null, total_credits: 10,
    created_at: '2026-11-18T10:00:00Z', candidates: generation.candidates.map(c => ({ ...c, state: 'running', song_id: null, version_id: null, error_code: null, audio_url: null })) };
export const draft: MusicDraft = { id: null, updated_at: null, revision: 0, model_id: 'ace-step-1.5', title: '', lyrics: '', styles: '' };
export const input: MusicInputSnapshot = { mode: 'simple', model_id: 'ace-step', prompt: 'ambient music', title: 'Evening', lyrics: '', styles: '', instrumental: true, duration: 30 };
export const custom: MusicInputSnapshot = { ...input, mode: 'custom', model_id: 'ace-step-1.5', lyrics: '[Verse]\nOriginal lyrics', instrumental: false };
