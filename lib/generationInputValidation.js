import { COSTUME_STYLES } from './costumePrompts.js';
import { GENERATION_PROMPT_MAX, NEGATIVE_PROMPT_MAX } from './generationPromptLimits.js';

// Provider payload allowlist. `inputs` is forwarded to fal verbatim, so
// every key the user may set is enumerated here with a bound; anything
// else is rejected. Quantity knobs (num_images, num_frames, duration
// beyond the priced unit, ...) are deliberately absent: the catalog price
// is per 5-second unit / single output and the payload must not buy more.
const MAX_INPUTS_BYTES = 256 * 1024;
const MAX_NON_PROMPT_INPUTS_BYTES = 8 * 1024;
// A 30,000-character prompt can occupy 180,000 JSON code units when every
// character needs a \uXXXX escape. Leave room for references and the envelope
// without weakening the per-field limits below.
// Output choices are bounded again by the model contract before the debit.
// Only tiers at or below the catalog's priced ceiling are declared there.
const ALLOWED_INPUTS = {
    prompt: { kind: 'string', max: GENERATION_PROMPT_MAX },
    negative_prompt: { kind: 'string', max: NEGATIVE_PROMPT_MAX },
    voice_description: { kind: 'string', max: 500 }, // a voice in words, for speech models that take one; never a recording
    // Auto Short (ADR-0029); TOPIC_RE is checked again by its provider entry.
    topic: { kind: 'string', max: 200 },
    // Video agent (ADR-0074): the approved brief and its plan token; both are re-checked by verifyPlanToken before the debit.
    brief: { kind: 'string', max: 500 },
    plan_id: { kind: 'string', max: 600 },
    narration_text: { kind: 'string', max: 300 },
    // Clip Editor: structured, so checked by lib/clipEditSources.js (within MAX_INPUTS_BYTES).
    clips: { kind: 'edit' },
    audio: { kind: 'edit' },
    captions: { kind: 'edit' },
    aspect_ratio: { kind: 'enum', values: ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9'] },
    duration_seconds: { kind: 'enum', values: [5, 10] },
    // ACE-Step v1 supports longer audio, but its one-Credit catalog unit is
    // costed at a maximum of 60 seconds. The model capability narrows this
    // outer bound to the one endpoint that declares the control.
    duration: { kind: 'int', min: 5, max: 60 },
    output_resolution: { kind: 'enum', values: ['480p', '720p'] },
    audio_enabled: { kind: 'bool' },
    seed: { kind: 'int', min: 0, max: 2147483647 },
    image_url: { kind: 'url' },
    // Transform filters that operate on a clip (PRD A6). Same rule as
    // image_url: HTTPS only, bounded length, and in practice always a
    // presigned URL this server minted — never a client-supplied host.
    video_url: { kind: 'url' },
    // Filter feature selectors, verified against the live fal schemas on
    // 2026-09-18 (scripts/verify-filter-endpoints.mjs). These are NOT the
    // quantity knobs the comment above excludes: choosing a makeup style or
    // a target age buys exactly one output, same as the default. Without
    // them the filter has no controls and is not a product — you cannot
    // "age modify" without saying to what age.
    //
    // Bounds mirror the provider's own enum and range, so a value this
    // allowlist accepts is one the provider accepts.
    makeup_style: { kind: 'enum', values: ['natural', 'glamorous', 'smoky_eyes', 'bold_lips', 'no_makeup', 'remove_makeup', 'dramatic', 'bridal', 'professional', 'korean_style', 'artistic'] },
    intensity: { kind: 'enum', values: ['light', 'medium', 'heavy', 'dramatic'] },
    // Costumes (face-costume): a style from our list; the wording is ours (lib/costumePrompts.js).
    costume_style: { kind: 'enum', values: COSTUME_STYLES },
    target_age: { kind: 'int', min: 6, max: 100 },
    preserve_identity: { kind: 'bool' },
};

/** @returns {{ok:true}|{ok:false,error:string}} */
export function validateInputs(inputs) {
    if (JSON.stringify(inputs).length > MAX_INPUTS_BYTES) return { ok: false, error: 'inputs_too_large' };
    const nonPromptInputs = typeof inputs?.prompt === 'string' ? { ...inputs, prompt: '' } : inputs;
    if (JSON.stringify(nonPromptInputs).length > MAX_NON_PROMPT_INPUTS_BYTES) return { ok: false, error: 'inputs_too_large' };
    for (const [key, value] of Object.entries(inputs)) {
        const rule = ALLOWED_INPUTS[key];
        if (!rule) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
        switch (rule.kind) {
            case 'string':
                if (typeof value !== 'string' || value.length > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'enum':
                if (!rule.values.includes(value)) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'int':
                if (!Number.isInteger(value) || value < rule.min || value > rule.max) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'bool':
                if (typeof value !== 'boolean') return { ok: false, error: `inputs_invalid:${key}` };
                break;
            case 'edit':
                break;
            case 'url': {
                let u;
                try { u = new URL(value); } catch { return { ok: false, error: `inputs_invalid:${key}` }; }
                if (u.protocol !== 'https:' || value.length > 2048) return { ok: false, error: `inputs_invalid:${key}` };
                break;
            }
            default:
                return { ok: false, error: `inputs_invalid:${key}` };
        }
    }
    return { ok: true };
}

