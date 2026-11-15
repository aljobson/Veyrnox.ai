// Mashup and "Sample this song" (migration 0522). The browser never sends
// audio or a URL: it names owned song versions and the Worker prepares the
// provider source from the stored PCM WAV masters.
import { musicCoverEnabled } from './musicBackend.js';
import { musicRuntimeFlag } from './musicRuntime.js';

export const MUSIC_REMIX_KINDS = Object.freeze(['mashup', 'sample']);
export const MUSIC_REMIX_PROMPT_MAX = 500;
export const MUSIC_MASHUP_SECONDS_MIN = 5;
export const MUSIC_MASHUP_SECONDS_MAX = 120;
export const MUSIC_SAMPLE_SECONDS_MIN = 5;
export const MUSIC_SAMPLE_SECONDS_MAX = 30;
export const MUSIC_SAMPLE_EXTEND_MIN = 10;
export const MUSIC_SAMPLE_EXTEND_MAX = 90;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MASHUP_KEYS = new Set(['kind', 'version_id', 'second_song_id', 'second_version_id', 'prompt', 'source_influence', 'rights_confirmed']);
const SAMPLE_KEYS = new Set(['kind', 'version_id', 'start_seconds', 'end_seconds', 'extend_seconds', 'prompt', 'rights_confirmed']);

/** Remix shares Cover's provider gates and adds its own switch. */
export const musicRemixEnabled = (env = process.env) => musicCoverEnabled(env)
    && musicRuntimeFlag('remix', env);

function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed) {
    return plainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function roundedSeconds(value) {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : NaN;
}

export function parseMusicRemixQuote(value) {
    if (!plainObject(value) || !MUSIC_REMIX_KINDS.includes(value.kind)) return { ok: false, error: 'invalid_request' };
    const keys = value.kind === 'mashup' ? MASHUP_KEYS : SAMPLE_KEYS;
    if (!exactKeys(value, keys)) return { ok: false, error: 'invalid_request' };
    if (!UUID_RE.test(value.version_id || '')) return { ok: false, error: 'version_id_invalid' };
    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt || prompt.length > MUSIC_REMIX_PROMPT_MAX) return { ok: false, error: 'prompt_invalid' };
    if (value.rights_confirmed !== true) return { ok: false, error: 'source_rights_required' };
    if (value.kind === 'mashup') {
        if (!UUID_RE.test(value.second_song_id || '') || !UUID_RE.test(value.second_version_id || '')) {
            return { ok: false, error: 'second_song_invalid' };
        }
        if (!Number.isInteger(value.source_influence) || value.source_influence < 10 || value.source_influence > 90) {
            return { ok: false, error: 'source_influence_invalid' };
        }
        return {
            ok: true, kind: 'mashup', versionId: value.version_id, prompt,
            secondSongId: value.second_song_id, secondVersionId: value.second_version_id,
            sourceInfluence: value.source_influence, rightsConfirmed: true,
        };
    }
    const start = roundedSeconds(value.start_seconds);
    const end = roundedSeconds(value.end_seconds);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0
        || end - start < MUSIC_SAMPLE_SECONDS_MIN || end - start > MUSIC_SAMPLE_SECONDS_MAX) {
        return { ok: false, error: 'sample_range_invalid' };
    }
    if (!Number.isInteger(value.extend_seconds)
        || value.extend_seconds < MUSIC_SAMPLE_EXTEND_MIN || value.extend_seconds > MUSIC_SAMPLE_EXTEND_MAX) {
        return { ok: false, error: 'sample_extend_invalid' };
    }
    return {
        ok: true, kind: 'sample', versionId: value.version_id, prompt,
        startSeconds: start, endSeconds: end, extendSeconds: value.extend_seconds, rightsConfirmed: true,
    };
}

/** The mixed length a Mashup quote is priced and checked against. */
export function mashupSeconds(firstSeconds, secondSeconds) {
    const seconds = Math.min(firstSeconds, secondSeconds, MUSIC_MASHUP_SECONDS_MAX);
    return Number.isFinite(seconds) ? Math.floor(seconds * 1000) / 1000 : NaN;
}

export function remixSourceKey(userId) {
    if (!UUID_RE.test(userId || '')) throw new Error('remix source owner invalid');
    return `music-remix-sources/${userId.toLowerCase()}/${crypto.randomUUID()}.wav`;
}
