/**
 * Project media: the inspection verdict (0141, ADR-0056).
 *
 * The allowlist, the per-type byte ceilings and both existing gates already
 * live in lib/uploadSource.js and are reused here, not restated:
 * `checkDeclared()` judges what the client claims before a presigned PUT is
 * issued, and `sniffType()` judges what the bytes are afterwards.
 *
 * What this file adds is the part M02 asks for and the upload path never had:
 * duration and frame bounds, and a single verdict shaped for
 * `record_project_asset_inspection`. That RPC takes either a sniffed type or a
 * reject reason, never both, so this returns exactly one of them.
 *
 * `inspectProjectAsset` is the only impure function, and only because an MP4's
 * `moov` box may sit after the media data: it forwards a `readRange` callback
 * to `mp4Info`, which then costs one extra ranged read rather than a download.
 * Everything a test needs can be faked through that callback.
 *
 * "Inspected" means well-formed. It does not mean safe — there is no malware
 * scanning here, deliberately and by ADR (no vendor yet).
 */

import { checkDeclared, sniffType, imageDimensions, SNIFF_BYTES, DIMENSION_BYTES } from './uploadSource.js';
import { mp4Info, wavSeconds } from './mediaLength.js';

/** Presigned project-asset URLs expire with everything else (CLAUDE.md, R2). */
export const ASSET_URL_TTL_SECONDS = 900;

/** How much of the head an inspection needs: enough to sniff and size a frame. */
export const INSPECT_HEAD_BYTES = DIMENSION_BYTES;

/**
 * Product limits, not security ones. Nothing in the codebase had a duration or
 * frame bound to inherit, so these are a first guess and the database's own
 * CHECKs (duration <= 60 min, side <= 16384) remain the outer wall.
 */
export const MAX_VIDEO_SECONDS = 600;
export const MAX_AUDIO_SECONDS = 1800;
export const MAX_FRAME_SIDE = 8192;

/** Reject reasons. The column accepts ^[a-z_]{3,40}$, so keep them in shape. */
export const REJECT_REASONS = Object.freeze({
    unreadable: 'unreadable_bytes',
    mismatch: 'type_mismatch',
    tooLarge: 'larger_than_declared',
    tooLong: 'longer_than_allowed',
    tooBigFrame: 'frame_larger_than_allowed',
    noDuration: 'duration_unreadable',
});

const isVideo = (t) => t === 'video/mp4';
const isAudio = (t) => t === 'audio/mpeg' || t === 'audio/wav';

/**
 * Judge stored bytes against the type the asset was reserved as.
 *
 * @param {object} input
 * @param {string} input.declaredType  the media type the asset was reserved with
 * @param {number} input.byteSize      the object's actual size in R2
 * @param {Uint8Array} input.head      the first INSPECT_HEAD_BYTES of the object
 * @param {(start:number, end:number) => Promise<Uint8Array>} input.readRange
 * @returns {Promise<{ok: true, sniffedType: string, byteSize: number,
 *   durationMs: number|null, width: number|null, height: number|null}
 *   | {ok: false, reason: string}>}
 */
export async function inspectProjectAsset({ declaredType, byteSize, head, readRange }) {
    // The declared pair must still be one we accept, and the stored object must
    // still fit its ceiling: a reservation can predate an allowlist change, and
    // the uploaded size is not necessarily the size that was declared.
    const declared = checkDeclared(declaredType, byteSize);
    if (!declared.ok) {
        return { ok: false, reason: declared.error === 'upload_too_large' ? REJECT_REASONS.tooLarge : REJECT_REASONS.mismatch };
    }
    const type = declared.contentType;

    if (!head || head.length < SNIFF_BYTES) return { ok: false, reason: REJECT_REASONS.unreadable };
    const sniffed = sniffType(head);
    if (!sniffed) return { ok: false, reason: REJECT_REASONS.unreadable };
    // The claim is not evidence: the bytes decide, and they must agree.
    if (sniffed !== type) return { ok: false, reason: REJECT_REASONS.mismatch };

    let durationMs = null;
    let width = null;
    let height = null;

    if (isVideo(type)) {
        const info = await mp4Info(readRange, byteSize);
        // A clip with no readable moov cannot be placed on a timeline, so an
        // unreadable duration is refused even though the file may be
        // structurally fine. mp4Info already looks past the media data.
        if (!info || !(info.seconds > 0)) return { ok: false, reason: REJECT_REASONS.noDuration };
        if (info.seconds > MAX_VIDEO_SECONDS) return { ok: false, reason: REJECT_REASONS.tooLong };
        if ((info.width || 0) > MAX_FRAME_SIDE || (info.height || 0) > MAX_FRAME_SIDE) {
            return { ok: false, reason: REJECT_REASONS.tooBigFrame };
        }
        durationMs = Math.round(info.seconds * 1000);
        width = info.width ?? null;
        height = info.height ?? null;
    } else if (isAudio(type)) {
        // Only WAV states its length in the header. An MP3's length needs a
        // frame walk this slice does not do, so it is recorded as unknown
        // rather than guessed or used as grounds for refusal.
        const seconds = type === 'audio/wav' ? wavSeconds(head, byteSize) : null;
        if (seconds !== null && seconds > MAX_AUDIO_SECONDS) return { ok: false, reason: REJECT_REASONS.tooLong };
        durationMs = seconds !== null && seconds > 0 ? Math.round(seconds * 1000) : null;
    } else {
        const size = imageDimensions(head);
        if (size && ((size.width || 0) > MAX_FRAME_SIDE || (size.height || 0) > MAX_FRAME_SIDE)) {
            return { ok: false, reason: REJECT_REASONS.tooBigFrame };
        }
        width = size?.width ?? null;
        height = size?.height ?? null;
    }

    return { ok: true, sniffedType: sniffed, byteSize, durationMs, width, height };
}

/** The verdict as `record_project_asset_inspection` wants it. */
export function inspectionRpcArgs(assetId, verdict) {
    return verdict.ok
        ? {
            p_asset_id: assetId, p_sniffed_type: verdict.sniffedType, p_byte_size: verdict.byteSize,
            p_duration_ms: verdict.durationMs, p_width: verdict.width, p_height: verdict.height,
            p_reject_reason: null,
        }
        : {
            p_asset_id: assetId, p_sniffed_type: null, p_byte_size: null, p_duration_ms: null,
            p_width: null, p_height: null, p_reject_reason: verdict.reason,
        };
}
