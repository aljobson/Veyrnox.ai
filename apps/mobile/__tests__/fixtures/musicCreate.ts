import type { MusicDraft, MusicEntitlements, MusicGeneration, MusicGenerationView, MusicInputSnapshot, MusicQuote } from '../../src/lib/music/types';
import { JOB, HOOK_JOB } from './music';
export const controls = { description: true, seed: false, variety: false, style_influence: false, exclude_styles: false, tempo_key_meter: false,
    duration_seconds: { min: 10, max: 60, default: 60 }, lyrics: false, styles: false, instrumental: 'required' as const };
export const entitlements: MusicEntitlements = { available: true, mode: 'simple', output_count: 2, concurrency_limit: 4, balance: 100, free_credits: 0, free_expires_at: null,
    models: [{ id: 'ace-step', name: 'ACE-Step', generation_modes: ['simple'], controls, credits_per_candidate: 5, total_credits: 10, instrumental_only: true, requires_paid_plan: false, available: true },
        { id: 'ace-step-1.5', name: 'ACE-Step 1.5', generation_modes: ['simple', 'custom'], controls: { ...controls, variety: true, style_influence: true,
            exclude_styles: true, tempo_key_meter: true, lyrics: true, styles: true, instrumental: 'optional' },
            credits_per_candidate: 10, total_credits: 20, instrumental_only: false, requires_paid_plan: true, available: true }],
    custom_drafts: { available: true, autosave: true, generation_supported: true, lyrics_max: 3000, styles_max: 500, title_max: 80 },
        features: { albums: false, inspiration: false, studioChat: false, dailyChallenge: false, persistentQueue: false, voices: false },
    inspiration_sources: [],
    daily_allowance: { enabled: false },
    policy: { version: 'music-v1', pre_debit: true } };
export const quote: MusicQuote = { quote_id: JOB, mode: 'simple', model_id: 'ace-step', output_count: 2, credits_per_candidate: 5, total_credits: 10,
    balance: 100, balance_after: 90, affordable: true, expires_at: '2099-01-01T00:00:00Z', policy_version: 'music-v1' };
export const generation: MusicGeneration = { generation_id: HOOK_JOB, state: 'queued', balance_after: 90,
    candidates: [{ ordinal: 1, label: 'A', job_id: JOB, state: 'queued' }, { ordinal: 2, label: 'B', job_id: HOOK_JOB, state: 'queued' }] };
export const view: MusicGenerationView = { id: HOOK_JOB, state: 'running', model_id: 'ace-step', prompt: 'ambient music', title: null, total_credits: 10,
    created_at: '2026-11-18T10:00:00Z', candidates: generation.candidates.map(c => ({ ...c, state: 'running', song_id: null, version_id: null, error_code: null, audio_url: null })) };
export const draft: MusicDraft = { id: null, updated_at: null, revision: 0, model_id: 'ace-step-1.5', title: '', lyrics: '', styles: '' };
export const input: MusicInputSnapshot = { mode: 'simple', model_id: 'ace-step', prompt: 'ambient music', title: 'Evening', lyrics: '', styles: '', instrumental: true, duration: 30,
    variety: 50, styleInfluence: 0, excludeStyles: '', sunoModel: 'v6', vocalGender: 'auto', weirdness: 0.5,
    bpm: '', keyScale: '', timeSignature: '' };
export const custom: MusicInputSnapshot = { ...input, mode: 'custom', model_id: 'ace-step-1.5', lyrics: '[Verse]\nOriginal lyrics',
    styles: 'cinematic', instrumental: false };
export const crunControls = {
    description: true, variety: ['Off', 'Normal', 'High', 'Extra', 'Max'], style_influence: true,
    exclude_styles: true, tempo_key_meter: false, duration_seconds: { min: 1, max: 135, default: 60, custom_only: true },
    lyrics: true, lyrics_required_for_custom_vocal: true, styles: true, title: true,
    vocal_gender: ['auto', 'male', 'female'] as const, suno_model: ['v6', 'v6_mini', 'v6_wild'] as const,
    suno_model_labels: { v6: 'Balanced', v6_mini: 'Fast', v6_wild: 'Creative' },
    weirdness: true, instrumental: 'optional' as const,
};
export const crunLimits = { prompt: 500, title: 80, lyrics: 5000, styles: 1000, exclude_styles: 1000,
    duration_seconds: { min: 1, max: 135, default: 60, custom_only: true },
    variety: { min: 0, max: 100, provider_min: 0, provider_max: 4 }, style_weight: { min: 0, max: 1 }, weirdness: { min: 0, max: 1 } };
export const crunCounters = { prompt: { max: 500 }, title: { max: 80 }, lyrics: { max: 5000 }, styles: { max: 1000 }, exclude_styles: { max: 1000, applied: 200 } };
export const crunEntitlements: MusicEntitlements = { ...entitlements,
    models: [{ ...entitlements.models[0], name: 'Veyrnox Music', provider_contract: 'crun-suno-v1', controls: { ...crunControls,
        duration_seconds: null, lyrics: false, lyrics_required_for_custom_vocal: false, styles: false, title: false, weirdness: false,
        variety: [], style_influence: false, exclude_styles: false, vocal_gender: [], suno_model: ['v6'],
        suno_model_labels: { v6: 'Balanced' }, instrumental: 'required' },
        limits: crunLimits, counters: crunCounters, credits_per_candidate: 4, total_credits: 8 },
    { ...entitlements.models[1], name: 'Veyrnox Music Pro', provider_contract: 'crun-suno-v1', controls: crunControls, limits: crunLimits,
        counters: crunCounters, credits_per_candidate: 4, total_credits: 8 }],
    custom_drafts: { ...entitlements.custom_drafts, provider_contract: 'crun-suno-v1', lyrics_max: 5000, styles_max: 1000 } };
export const crunDraft: MusicDraft = { ...draft, id: JOB, provider_contract: 'crun-suno-v1' };
export const crunCustom: MusicInputSnapshot = { ...custom, duration: 135, styles: 'cinematic', excludeStyles: 'choir',
    sunoModel: 'v6_wild', vocalGender: 'female', styleInfluence: 70, weirdness: 0.35, variety: 75 };
export const crunQuote: MusicQuote = { ...quote, mode: 'custom', provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5',
    credits_per_candidate: 4, total_credits: 8, balance_after: 92, suno_model: 'v6_wild', vocal_gender: 'female',
    style_weight: 0.7, weirdness: 0.35, variety: 3, exclude_styles_applied_chars: 200 };
