/**
 * Auto Short pipeline steps — slice 1 of docs/auto-short/SPEC.md (ADR-0029).
 *
 * Records in the capability-registry shape (lib/modelCapabilities.js) for the
 * four provider calls one Auto Short makes. They are kept out of REGISTRY on
 * purpose: REGISTRY is keyed by catalog `provider_endpoint` and decides what
 * is sellable, while these calls are only ever made by the orchestrator under
 * the parent job's single debit. A step pins what its cost in the spec (§3)
 * assumes, exactly as a catalog record does.
 *
 * `preset` holds our-side input values forced on every call (the scene aspect
 * ratio); `record` holds provider fields as in the registry.
 */

import { capabilityFor } from './modelCapabilities.js';

// ~80 words of narration is ~480 characters; ElevenLabs bills per character,
// so the cap bounds the voice at $0.03 (fal: $0.05 per 1000 characters).
export const NARRATION_MAX_CHARS = 600;
export const SCENE_COUNT = 4;
export const SCENE_MS = 8000;

// Parent-job input: the topic the user types.
export const TOPIC_RE = /^[\p{L}\p{N}\p{P}\p{Zs}]{3,200}$/u;

const SCENE_RECORD = capabilityFor('veo:veo3_lite');

export const STEPS = Object.freeze({
    // OpenRouter chat completion, synchronous. ~300 tokens in, ~500 out:
    // about $0.003 at $1 / $5 per million.
    script: {
        provider: 'openrouter',
        endpoint: 'anthropic/claude-haiku-4.5',
        record: {
            provider: 'openrouter', kind: 'text',
            inputs: { topic: { type: 'string', max: 200, required: true } },
            rename: {},
            media: {}, lengths: null,
            fixed: { max_tokens: 900, temperature: 0.7, response_format: { type: 'json_object' } },
            assumes: {},
        },
        preset: {},
    },
    // Word timings come back as character alignment chunks (slice 0), which
    // the WebVTT captions are built from, so timestamps are pinned on here,
    // unlike the sellable record.
    voice: {
        provider: 'fal',
        endpoint: 'fal-ai/elevenlabs/tts/turbo-v2.5',
        record: {
            provider: 'fal', kind: 'speech',
            inputs: { text: { type: 'string', max: NARRATION_MAX_CHARS, required: true } },
            rename: {},
            media: {}, lengths: null,
            fixed: { timestamps: true },
            assumes: {},
        },
        preset: {},
    },
    // The sellable Veo 3.1 Lite record (8s 720p, $0.15), forced vertical.
    scene: {
        provider: 'kie',
        endpoint: 'veo:veo3_lite',
        record: SCENE_RECORD,
        preset: { aspect_ratio: '9:16' },
    },
    // fal hosted ffmpeg. Keeps only audio-track sound: the clips' own audio
    // is dropped (slice 0), so no muting is needed. Price not yet published.
    stitch: {
        provider: 'fal',
        endpoint: 'fal-ai/ffmpeg-api/compose',
        record: {
            provider: 'fal', kind: 'video',
            inputs: { tracks: { type: 'array', required: true } },
            rename: {},
            media: {}, lengths: null,
            fixed: {},
            assumes: {},
        },
        preset: {},
    },
});

/**
 * The compose request for four stored scenes and one voice track. URLs are
 * short-lived presigned GETs on our own R2 objects (spec §2).
 * @param {string[]} sceneUrls  in scene order
 * @param {string} voiceUrl
 * @param {number} voiceMs      measured voice length, capped at the video length
 */
export function stitchTracks(sceneUrls, voiceUrl, voiceMs) {
    if (!Array.isArray(sceneUrls) || sceneUrls.length !== SCENE_COUNT) throw new Error('stitch needs 4 scenes');
    const total = SCENE_COUNT * SCENE_MS;
    const ms = Math.min(Math.max(Math.round(voiceMs) || 0, 1), total);
    return [
        { id: 'scenes', type: 'video',
            keyframes: sceneUrls.map((url, i) => ({ timestamp: i * SCENE_MS, duration: SCENE_MS, url })) },
        { id: 'voice', type: 'audio', keyframes: [{ timestamp: 0, duration: ms, url: voiceUrl }] },
    ];
}

/**
 * Voice length in ms from ElevenLabs' alignment chunks
 * ([{character_end_times_seconds[]}]), or null when there are none.
 */
export function voiceLengthMs(timestamps) {
    const ends = (Array.isArray(timestamps) ? timestamps : [])
        .flatMap((c) => (c && Array.isArray(c.character_end_times_seconds) ? c.character_end_times_seconds : []))
        .filter(Number.isFinite);
    return ends.length ? Math.round(Math.max(...ends) * 1000) : null;
}
