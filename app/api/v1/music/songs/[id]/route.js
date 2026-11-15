import { retryAfterSeconds } from '../../../../../../lib/rateLimitHeaders.js';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';
import {
    deleteObject, envConfig as r2EnvConfig, getObject, isConfigured as r2IsConfigured, putObject,
} from '../../../../../../packages/adapters/r2.js';
import { publishFalDispatchWakeup } from '../../../../../../lib/falDispatchWakeup.js';
import { inspectStoredSource } from '../../../../../../lib/resolveSource.js';
import { musicAddSectionEnabled, musicCoverEnabled, musicDistributionEnabled, musicEditingEnabled, musicExtendEnabled, musicLibraryEnabled, musicPromptPolicy, musicPublicationEnabled, musicReplaceEnabled, musicReuseEnabled, musicRpcStatus, musicSchemaEnabled, musicStemsEnabled, musicStudioEnabled, musicTargetStemsEnabled, musicTrackAddEnabled, parseMusicGeneration, parseMusicSongLifecycle, publicMusicError, readMusicJson, validMusicAuthId } from '../../../../../../lib/musicBackend.js';
import { musicLyricsEnabled, publicLyrics } from '../../../../../../lib/musicLyrics.js';
import {
    MUSIC_MASHUP_SECONDS_MAX, MUSIC_MASHUP_SECONDS_MIN, mashupSeconds, musicRemixEnabled,
    parseMusicRemixQuote, remixSourceKey,
} from '../../../../../../lib/musicRemix.js';
import { renderPcmWavCrop, renderPcmWavMix } from '../../../../../../lib/musicWavRender.js';
import { isUuid } from '../../../../../../lib/validate.js';

const MAX_REMIX_SOURCE_BYTES = 26_214_400;
const reply = (body, status = 200, headers = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', ...headers },
});

async function measureRemixSource(source, r2cfg) {
    const inspected = await inspectStoredSource(source.r2_key, { contentType: source.mime_type, field: 'audio_url' }, r2cfg);
    return inspected.ok && Number.isFinite(inspected.seconds) ? inspected.seconds : NaN;
}

async function readRemixSource(source, r2cfg) {
    if (source.mime_type !== 'audio/wav' || Number(source.size_bytes) > MAX_REMIX_SOURCE_BYTES) return null;
    const stored = await getObject(source.r2_key, r2cfg);
    if (!stored.ok) return null;
    const bytes = new Uint8Array(await stored.response.arrayBuffer());
    return bytes.length === Number(source.size_bytes) ? bytes : null;
}

function remixCandidates(jobIds, state) {
    return (jobIds || []).map((jobId, index) => ({
        ordinal: index + 1, label: index === 0 ? 'A' : 'B', job_id: jobId, state,
    }));
}

export async function GET(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicSchemaEnabled()) return reply({ error: 'music_unavailable' }, 404);
    const { id } = await params;
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_get_song', { p_auth_id: authId, p_song_id: id }, cfg);
        if (!result?.ok) return reply({ error: 'not_found' }, 404);
        const lyrics = musicLyricsEnabled()
            ? await rpc('music_get_song_lyrics', { p_auth_id: authId, p_song_id: id }, cfg).catch(() => null) : null;
        const actions = Array.isArray(result.song?.actions) ? result.song.actions : [];
        // Stems and Track add take an MP3 source only (Mureka), and the only Music
        // version stored as MP3 is a Cover. Offering them on any other version led
        // to a quote that always answered format_unavailable. The SQL gates stay the
        // authority; this only stops showing an action that cannot succeed.
        const mp3Source = result.song?.current_version?.operation === 'cover';
        const distributionActions = musicDistributionEnabled()
            ? [...actions, 'share_link', 'download_mp3'] : actions;
        return reply({
            ...result.song,
            // The lyrics the song was made from (0535); a failed read leaves them out.
            ...(lyrics?.ok && publicLyrics(lyrics.lyrics) ? { lyrics: publicLyrics(lyrics.lyrics) } : {}),
            actions: [...new Set([
                ...distributionActions,
                ...(musicPublicationEnabled() ? ['publish'] : []),
                ...(musicCoverEnabled() ? ['cover'] : []),
                ...(musicRemixEnabled() ? ['mashup', 'sample'] : []),
                ...(musicExtendEnabled() ? ['extend'] : []),
                ...(musicReplaceEnabled() ? ['replace_section'] : []),
                ...(musicAddSectionEnabled() ? ['add_section'] : []),
                ...(musicReuseEnabled() && result.song?.generation_id ? ['reuse'] : []),
                ...(musicStemsEnabled() && mp3Source ? ['stems'] : []),
                ...(musicTargetStemsEnabled() ? ['target_stem'] : []),
                ...(musicTrackAddEnabled() && mp3Source ? ['add_track'] : []),
                ...(musicStudioEnabled() ? ['open_studio'] : []),
                ...(isUuid(result.song?.job_id || '') ? ['open_editor'] : []),
                ...(musicEditingEnabled() ? ['crop', 'render'] : []),
            ])],
        });
    } catch (error) {
        console.error('[music/songs/get] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function PATCH(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicLibraryEnabled()) return reply({ error: 'music_library_unavailable' }, 404);
    const { id } = await params;
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);
    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    const input = parseMusicSongLifecycle(decoded.value);
    if (!input.ok) return reply({ error: input.error }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'gateway_not_configured' }, 503);
    try {
        const result = await rpc('music_set_song_lifecycle', {
            p_auth_id: authId,
            p_song_id: id,
            p_revision: input.revision,
            p_action: input.action,
        }, cfg);
        if (!result?.ok) return reply({ error: publicMusicError(result?.code) }, musicRpcStatus(result?.code));
        return reply({ song: result.song, idempotent: result.idempotent === true });
    } catch (error) {
        console.error('[music/songs/lifecycle] rpc failed:', error?.message);
        return reply({ error: 'temporarily_unavailable' }, 502);
    }
}

export async function POST(request, { params }) {
    const authId = request.headers.get('x-veyrnox-auth-id');
    const { id } = await params;
    if (!validMusicAuthId(authId)) return reply({ error: 'not_authenticated' }, 401);
    if (!musicRemixEnabled()) return reply({ error: 'music_remix_unavailable' }, 404);
    if (!isUuid(id || '')) return reply({ error: 'song_id_invalid' }, 400);

    const decoded = await readMusicJson(request);
    if (!decoded.ok) return reply({ error: decoded.error }, decoded.error === 'body_too_large' ? 413 : 400);
    if (!decoded.value || typeof decoded.value !== 'object' || Array.isArray(decoded.value)) {
        return reply({ error: 'invalid_request' }, 400);
    }
    const { phase, ...payload } = decoded.value;
    if (phase !== 'quote' && phase !== 'confirm') return reply({ error: 'invalid_request' }, 400);

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return reply({ error: 'gateway_not_configured' }, 503);
    }
    if (phase === 'quote') {
        const input = parseMusicRemixQuote(payload);
        if (!input.ok) return reply({ error: input.error }, 400);
        if (input.kind === 'mashup' && input.secondSongId.toLowerCase() === id.toLowerCase()) {
            return reply({ error: 'second_song_invalid' }, 400);
        }
        const policy = musicPromptPolicy(input.prompt);
        if (!policy.ok) return reply({ error: policy.error }, 422);
        try {
            const context = await rpc('music_get_remix_source_context', {
                p_auth_id: authId, p_song_id: id, p_version_id: input.versionId,
                p_second_song_id: input.kind === 'mashup' ? input.secondSongId : null,
                p_second_version_id: input.kind === 'mashup' ? input.secondVersionId : null,
            }, cfg);
            if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
            const seconds = await Promise.all((context.sources || []).map((source) => measureRemixSource(source, r2cfg)));
            if (!seconds.length || seconds.some((value) => !Number.isFinite(value))) {
                return reply({ error: 'source_duration_unavailable' }, 400);
            }
            let duration = seconds[0];
            if (input.kind === 'mashup') {
                duration = mashupSeconds(seconds[0], seconds[1]);
                if (!(duration >= MUSIC_MASHUP_SECONDS_MIN)) return reply({ error: 'source_duration_invalid' }, 400);
            } else if (input.endSeconds > seconds[0]) {
                return reply({ error: 'sample_range_invalid', duration_seconds: seconds[0] }, 400);
            }
            const result = await rpc('music_create_remix_quote', {
                p_auth_id: authId,
                p_kind: input.kind,
                p_song_id: id,
                p_version_id: input.versionId,
                p_second_song_id: input.kind === 'mashup' ? input.secondSongId : null,
                p_second_version_id: input.kind === 'mashup' ? input.secondVersionId : null,
                p_prompt: input.prompt,
                p_source_influence: input.kind === 'mashup' ? input.sourceInfluence : null,
                p_sample_start: input.kind === 'sample' ? input.startSeconds : null,
                p_sample_end: input.kind === 'sample' ? input.endSeconds : null,
                p_sample_extend: input.kind === 'sample' ? input.extendSeconds : null,
                p_rights_confirmed: input.rightsConfirmed,
                p_source_duration_seconds: duration,
            }, cfg);
            if (!result?.ok) {
                const status = musicRpcStatus(result?.code);
                const headers = status === 429
                    ? { 'Retry-After': String(retryAfterSeconds(result.retry_after_seconds, { max: 600, fallback: 60 })) }
                    : {};
                return reply({ error: publicMusicError(result?.code) }, status, headers);
            }
            return reply({
                quote_id: result.quote_id,
                kind: result.kind,
                model_id: result.model_id,
                output_count: 2,
                credits_per_candidate: result.unit_credits,
                total_credits: result.total_credits,
                balance: result.balance,
                balance_after: result.balance_after,
                affordable: result.affordable,
                expires_at: result.expires_at,
                source_duration_seconds: result.source_duration_seconds,
                policy_version: policy.version,
            }, 201);
        } catch (error) {
            console.error('[music/songs/remix-quote] failed:', error?.message);
            return reply({ error: 'temporarily_unavailable' }, 502);
        }
    }

    const input = parseMusicGeneration(payload);
    if (!input.ok) return reply({ error: input.error }, 400);
    let preparedKey = null;
    try {
        const context = await rpc('music_get_remix_dispatch_context', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId, p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (!context?.ok) return reply({ error: publicMusicError(context?.code) }, musicRpcStatus(context?.code));
        if (context.idempotent) return reply({
            generation_id: context.request_id, state: context.state,
            candidates: remixCandidates(context.job_ids, context.state),
            balance_after: context.balance_after, idempotent: true,
        });
        const sources = await Promise.all((context.sources || []).map((source) => readRemixSource(source, r2cfg)));
        if (!sources.length || sources.some((bytes) => !bytes)) return reply({ error: 'source_unavailable' }, 409);
        const rendered = context.kind === 'mashup'
            ? renderPcmWavMix(sources[0], sources[1], MUSIC_MASHUP_SECONDS_MAX)
            : renderPcmWavCrop(sources[0], Number(context.sample_start_seconds), Number(context.sample_end_seconds));
        if (!rendered.ok) return reply({ error: rendered.error }, 400);
        if (Math.abs(rendered.seconds - Number(context.source_duration_seconds)) > 0.1) {
            return reply({ error: 'source_changed' }, 409);
        }
        preparedKey = remixSourceKey(context.user_id);
        const uploaded = await putObject(preparedKey, rendered.bytes, 'audio/wav', r2cfg);
        if (!uploaded.ok) { preparedKey = null; return reply({ error: 'render_storage_failed' }, 502); }
        const signed = await inspectStoredSource(preparedKey, { contentType: 'audio/wav', field: 'audio_url' }, r2cfg);
        if (!signed.ok || !signed.url) {
            await deleteObject(preparedKey, r2cfg);
            return reply({ error: 'source_duration_unavailable' }, 502);
        }
        const result = await rpc('music_submit_remix_pair', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId,
            p_idempotency_key: input.idempotencyKey, p_prepared_r2_key: preparedKey,
            p_prepared_audio_url: signed.url, p_prepared_seconds: rendered.seconds,
        }, cfg);
        if (!result?.ok || result.idempotent) await deleteObject(preparedKey, r2cfg);
        if (!result?.ok) {
            const status = result?.code === 'SOURCE_CHANGED' ? 409 : musicRpcStatus(result?.code);
            const headers = status === 429 || status === 503
                ? { 'Retry-After': String(retryAfterSeconds(result?.retry_after_seconds, { max: 600, fallback: 60 })) }
                : {};
            return reply({ error: publicMusicError(result?.code) }, status, headers);
        }
        for (const jobId of result.job_ids || []) {
            try { publishFalDispatchWakeup(jobId); }
            catch { console.error('[music/songs/remix] dispatch wakeup unavailable:', jobId); }
        }
        return reply({
            generation_id: result.request_id, state: result.state,
            candidates: remixCandidates(result.job_ids, 'queued'),
            balance_after: result.balance_after,
            ...(result.idempotent ? { idempotent: true } : {}),
        }, result.idempotent ? 200 : 202);
    } catch (error) {
        console.error('[music/songs/remix] admission failed:', error?.message);
        if (preparedKey) await discardUnclaimedSource(preparedKey, { authId, id, input, cfg, r2cfg });
        return reply({ error: 'pair_acceptance_unknown' }, 503);
    }
}

// The prepared mix must not outlive a failed admission. If the submit RPC never
// committed (no request under this idempotency key), nothing references the
// object, so it is deleted. If the request exists, music_remix_sources holds it
// and the settled pair queues it for reaping. If even the check fails, the key
// is logged so the reaper can be pointed at it.
async function discardUnclaimedSource(key, { authId, id, input, cfg, r2cfg }) {
    try {
        const check = await rpc('music_get_remix_dispatch_context', {
            p_auth_id: authId, p_song_id: id, p_quote_id: input.quoteId, p_idempotency_key: input.idempotencyKey,
        }, cfg);
        if (check?.ok && check.idempotent) return;
        await deleteObject(key, r2cfg);
    } catch {
        console.error('[music/songs/remix] prepared source left for reaping:', key);
    }
}
