/**
 * Capability records for the motion-transfer offers (ADR-0269). Kept out of
 * modelCapabilities.js (already at its size limit) and spread into REGISTRY.
 *
 * Neither record has a client video slot. The driving clip is ours: the
 * generation route resolves it (lib/motionTransfer.js) and hands it to
 * `derive` as `sources.motion_clip`. The price per 5 s is the catalog's; the
 * length is the clip's (migration 0402).
 *
 * Schemas and prices read from fal on 2026-10-27:
 *   Kling 3.0 Motion Control Standard  $0.126 per output second, 720p
 *   Wan 2.2 Animate Replace            $0.08 per output second at 720p
 */

import { motionClipIds } from './motionClips.js';

const template = (mode) => ({ type: 'enum', values: motionClipIds(mode) });
const PHOTO = { field: 'image_url', required: true, kind: 'image', label: 'Your photo', maxPixels: 25_000_000 };

function needsTemplate(inputs) {
    return typeof inputs.motion_template === 'string' && inputs.motion_template
        ? { ok: true } : { ok: false, error: 'inputs_invalid:motion_template' };
}

export const MOTION = Object.freeze({
    // Clip and camera move from the template; no prompt in v1. The clip's own
    // sound is never kept: the preview's music is added outside the model.
    'fal-ai/kling-video/v3/standard/motion-control': {
        provider: 'fal', kind: 'video', motion: 'move',
        inputs: { motion_template: template('move') },
        rename: { motion_template: null },
        media: { image: PHOTO },
        lengths: null,
        fixed: { keep_original_sound: false, enable_safety_checker: true },
        assumes: {},
        derive: (_inputs, sources) => ({
            video_url: sources.motion_clip.url,
            character_orientation: sources.motion_clip.orientation,
        }),
        derives: ['video_url', 'character_orientation'],
        validate: needsTemplate,
    },
    // Both safety checkers default to off on fal; ours are on. 720p is the
    // priced tier.
    'fal-ai/wan/v2.2-14b/animate/replace': {
        provider: 'fal', kind: 'video', motion: 'replace',
        inputs: { motion_template: template('replace') },
        rename: { motion_template: null },
        media: { image: PHOTO },
        lengths: null,
        fixed: { resolution: '720p', enable_safety_checker: true, enable_output_safety_checker: true },
        assumes: { use_turbo: false, video_quality: 'high' },
        derive: (_inputs, sources) => ({ video_url: sources.motion_clip.url }),
        derives: ['video_url'],
        validate: needsTemplate,
    },
});
