/**
 * Motion-transfer offers (ADR-0269): the flag gate and the server-side clip
 * resolution the generation route runs before the debit.
 *
 * A motion record (`record.motion` is 'move' or 'replace') has no client video
 * slot. The route asks this module for the template's driving clip, gets a
 * 15-minute presigned URL for the model and the clip's own length for the
 * price. A client length or an unknown or unready clip is refused here.
 */

import { motionClipFor, MOTION_CLIPS } from './motionClips.js';

// CLAUDE.md: presigned URLs live at most 15 minutes.
export const MOTION_CLIP_URL_SECONDS = 900;

const FLAG_FOR_MODE = Object.freeze({ move: 'MOTION_TRANSFER_ENABLED', replace: 'MOTION_REPLACE_ENABLED' });

/** Off unless the mode's own flag is exactly "true". Absent means off. */
export function motionTransferEnabled(env, mode) {
    const flag = Object.hasOwn(FLAG_FOR_MODE, mode) ? FLAG_FOR_MODE[mode] : null;
    return !!flag && !!env && env[flag] === 'true';
}

const refuse = (status, error) => ({ ok: false, status, error });

/**
 * Resolve the driving clip a motion request names.
 * @param {{ record: object, modelInputs: Record<string, unknown>, r2cfg: object|null }} args
 * @param {{ presign: (key: string, seconds: number, cfg: object) => Promise<string>, isConfigured: (cfg: object|null) => boolean, clips?: readonly object[] }} deps
 * @returns {Promise<{ok: true, url: string, seconds: number, orientation: string|null, clipId: string} | {ok: false, status: number, error: string}>}
 */
export async function resolveMotionClip({ record, modelInputs, r2cfg }, deps) {
    // The length is the clip's, never the caller's: a client value is refused, not ignored.
    if (modelInputs && Object.hasOwn(modelInputs, 'duration_seconds')) return refuse(400, 'inputs_key_not_allowed:duration_seconds');
    const clip = motionClipFor(modelInputs && modelInputs.motion_template, deps.clips || MOTION_CLIPS);
    if (!clip || clip.mode !== record.motion) return refuse(400, 'motion_template_unknown');
    if (!clip.ready) return refuse(400, 'motion_template_unavailable');
    if (!deps.isConfigured(r2cfg)) return refuse(503, 'gateway_not_configured');
    let url;
    try {
        url = await deps.presign(clip.key, MOTION_CLIP_URL_SECONDS, r2cfg);
    } catch (err) {
        console.error('[motion] clip presign failed:', clip.id, err && err.message);
        return refuse(502, 'motion_clip_unavailable');
    }
    if (typeof url !== 'string' || !url.startsWith('https://')) return refuse(502, 'motion_clip_unavailable');
    return { ok: true, url, seconds: clip.seconds, orientation: clip.orientation, clipId: clip.id };
}

/** Inputs the price is computed from: the clip's length, nothing the client sent. */
export function motionPricedInputs(resolved) {
    return { duration_seconds: resolved.seconds };
}

/** Sources for the provider submit: the caller's, plus the server's clip under its own key. */
export function motionSubmitSources(sources, resolved) {
    return { ...sources, motion_clip: { url: resolved.url, orientation: resolved.orientation } };
}
