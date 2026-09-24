/**
 * Turn a Clip Editor request into a validated edit (docs/editor/PRD.md §5).
 *
 * The client names Assets by the id of the job that made them. Each one is
 * looked up through get_user_asset, which checks the caller owns it, and
 * must be a finished video (clips) or audio (soundtrack). A clip's length
 * and frame come from its own MP4 headers, read with ranged GETs, never
 * from the client. lib/clipEdit.validateEdit then checks the cuts, the
 * aspect ratio and the 60 s cap on real numbers.
 */

import { presignGetUrl } from '../packages/adapters/r2.js';
import { rpc } from '../packages/db/supabase-client.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { mp4Info } from './mediaLength.js';
import { validateEdit, MAX_CLIPS, MAX_OUTPUT_S } from './clipEdit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Longer than any Asset we generate; bounds the numbers before any lookup.
const MAX_SECONDS = 3600;
// Only needs to outlive the header reads; CLAUDE.md caps presigned URLs at 15 min.
const READ_URL_TTL_SECONDS = 300;
const READ_TIMEOUT_MS = 10000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const seconds = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_SECONDS;

/** Shape check at the boundary, before any lookup. */
export function parseEditInputs(inputs) {
    const { clips, audio } = inputs || {};
    if (!Array.isArray(clips) || clips.length < 1 || clips.length > MAX_CLIPS) return { ok: false, error: 'inputs_invalid:clips' };
    for (const c of clips) {
        if (!isObject(c) || !onlyKeys(c, ['asset_id', 'in_s', 'out_s'])
            || typeof c.asset_id !== 'string' || !UUID_RE.test(c.asset_id) || !seconds(c.in_s) || !seconds(c.out_s)) {
            return { ok: false, error: 'inputs_invalid:clips' };
        }
    }
    if (audio !== undefined && (!isObject(audio) || !onlyKeys(audio, ['asset_id', 'offset_s'])
        || typeof audio.asset_id !== 'string' || !UUID_RE.test(audio.asset_id) || !seconds(audio.offset_s))) {
        return { ok: false, error: 'inputs_invalid:audio' };
    }
    // The client's own numbers already say whether this edit can exist. The
    // real lengths still decide (they come from the stored files), but an
    // edit that is too long by its own account is refused here — before up to
    // ten ownership lookups, ten presigns and ninety ranged R2 reads. The
    // gateway's attempt quota (0113) bounds how often this path can run, but
    // cheap shape checks should still reject impossible edits before I/O.
    const declared = clips.reduce((n, c) => n + Math.max(0, c.out_s - c.in_s), 0);
    if (declared > MAX_OUTPUT_S + 0.05) return { ok: false, error: 'too_long' };
    if (declared <= 0) return { ok: false, error: 'inputs_invalid:clips' };
    return { ok: true, clips, audio: audio || null };
}

/** Frame and length of one stored MP4, from ranged reads of its headers. */
async function readMp4(key, size, r2cfg) {
    const { url } = await presignGetUrl(key, READ_URL_TTL_SECONDS, r2cfg);
    const readRange = async (start, end) => {
        const res = await fetchWithTimeout(url, { headers: { Range: `bytes=${start}-${end}` } }, READ_TIMEOUT_MS);
        if (res.status !== 206 && res.status !== 200) throw new Error(`range ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    };
    return mp4Info(readRange, size);
}

export function defaultDeps(cfg, r2cfg) {
    return {
        asset: (authId, jobId) => rpc('get_user_asset', { p_auth_id: authId, p_job_id: jobId }, cfg),
        mp4: (key, size) => readMp4(key, size, r2cfg),
    };
}

/**
 * @returns {Promise<{ok:true, edit:object}|{ok:false, error:string, status:number}>}
 */
export async function resolveEdit(authId, inputs, deps) {
    const parsed = parseEditInputs(inputs);
    if (!parsed.ok) return { ...parsed, status: 400 };

    const seen = new Map();
    const infos = new Map();
    const lookup = async (id) => {
        if (!seen.has(id)) seen.set(id, await deps.asset(authId, id));
        return seen.get(id);
    };
    const clips = [];
    for (const c of parsed.clips) {
        const a = await lookup(c.asset_id);
        // Another user's Asset reads exactly like one that does not exist.
        if (!a || !a.ok || a.state !== 'STORED') return { ok: false, error: 'asset_not_found', status: 404 };
        if (a.mime_type !== 'video/mp4') return { ok: false, error: 'clip_not_video', status: 400 };
        if (!infos.has(a.r2_key)) infos.set(a.r2_key, await deps.mp4(a.r2_key, Number(a.size_bytes)).catch(() => null));
        const info = infos.get(a.r2_key);
        if (!info || !info.width || !info.height) return { ok: false, error: 'clip_unreadable', status: 400 };
        clips.push({ key: a.r2_key, in_s: c.in_s, out_s: c.out_s, duration_s: info.seconds, aspect: (info.width / info.height).toFixed(2) });
    }
    let audio;
    if (parsed.audio) {
        const a = await lookup(parsed.audio.asset_id);
        if (!a || !a.ok || a.state !== 'STORED') return { ok: false, error: 'asset_not_found', status: 404 };
        if (!/^audio\//.test(String(a.mime_type))) return { ok: false, error: 'audio_not_audio', status: 400 };
        audio = { key: a.r2_key, offset_s: parsed.audio.offset_s };
    }
    const edit = validateEdit({ clips, audio });
    return edit.ok ? { ok: true, edit } : { ok: false, error: edit.error, status: 400 };
}
