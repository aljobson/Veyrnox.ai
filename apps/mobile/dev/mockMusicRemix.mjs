import { randomUUID } from 'node:crypto';
import { parseMusicRemixQuote } from '../../../lib/musicRemix.js';

const PRIMARY_SONG_ID = '11111111-2222-4333-8444-555555555551';
const SECONDARY_SONG_ID = '11111111-2222-4333-8444-555555555552';
const PRIMARY_VERSION_ID = '21111111-2222-4333-8444-555555555551';
const SECONDARY_VERSION_ID = '21111111-2222-4333-8444-555555555552';

const songs = [
    { id: PRIMARY_SONG_ID, title: 'Neon Afterglow', job_id: '31111111-2222-4333-8444-555555555551',
        version_id: PRIMARY_VERSION_ID, lifecycle_status: 'active', revision: 1 },
    { id: SECONDARY_SONG_ID, title: 'Midnight Current', job_id: '31111111-2222-4333-8444-555555555552',
        version_id: SECONDARY_VERSION_ID, lifecycle_status: 'active', revision: 1 },
];

const versions = new Map([
    [PRIMARY_SONG_ID, PRIMARY_VERSION_ID],
    [SECONDARY_SONG_ID, SECONDARY_VERSION_ID],
]);
const durations = new Map([
    [PRIMARY_SONG_ID, 90],
    [SECONDARY_SONG_ID, 120],
]);

function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function songDetail(id) {
    const song = songs.find(row => row.id === id);
    const versionId = versions.get(id);
    if (!song || !versionId) return null;
    const currentVersion = {
        id: versionId, version_number: 1, operation: 'generation', parent_version_id: null,
        created_at: '2026-11-25T00:00:00.000Z', mime_type: 'audio/wav', size_bytes: 2_880_044,
        capabilities: { playback: true, download: true, render: true, crop: true, remix: true,
            mashup: true, sample: true, stems: true, target_stem: true, track_add: true,
            cover: true, extend: true, replace_section: true, add_section: true },
    };
    return { ...song, current_version: currentVersion, versions: [{ ...currentVersion, is_current: true }],
        actions: ['mashup', 'sample'], provenance: { source: 'development-mock' } };
}

function quote(songId, body, balance) {
    const parsed = parseMusicRemixQuote(body);
    if (!parsed.ok || (parsed.kind === 'mashup' && parsed.secondSongId === songId)) return null;
    const value = {
        kind: parsed.kind, quote_id: randomUUID(), model_id: `stable-audio-3-${parsed.kind}`, output_count: 2,
        credits_per_candidate: 8, total_credits: 16, balance, balance_after: balance - 16,
        affordable: balance >= 16, expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        source_duration_seconds: parsed.kind === 'mashup'
            ? Math.min(durations.get(songId), durations.get(parsed.secondSongId))
            : parsed.endSeconds - parsed.startSeconds,
        policy_version: 'development-mock-v1',
    };
    return { parsed, value };
}

export function mockMusicRemix(req, res, url, body, state) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/v1/music/songs') {
        send(res, 200, { songs });
        return true;
    }
    const songMatch = path.match(/^\/api\/v1\/music\/songs\/([0-9a-f-]+)$/i);
    if (songMatch && req.method === 'GET') {
        const detail = songDetail(songMatch[1]);
        send(res, detail ? 200 : 404, detail ?? { error: 'not_found' });
        return true;
    }
    if (songMatch && req.method === 'POST' && body?.phase === 'quote') {
        const detail = songDetail(songMatch[1]);
        const { phase: _phase, ...quoteBody } = body;
        if (detail && quoteBody.version_id !== versions.get(songMatch[1])) {
            send(res, 409, { error: 'source_changed' });
            return true;
        }
        if (detail && quoteBody.kind === 'mashup') {
            if (!songDetail(quoteBody.second_song_id)
                || quoteBody.second_version_id !== versions.get(quoteBody.second_song_id)) {
                send(res, 400, { error: 'second_song_invalid' });
                return true;
            }
        }
        const created = detail ? quote(songMatch[1], quoteBody, state.balance) : null;
        if (created) state.musicRemixQuotes.set(created.value.quote_id, {
            songId: songMatch[1], prompt: created.parsed.prompt, ...created.value,
        });
        send(res, created ? 201 : detail ? 400 : 404, created?.value ?? { error: detail ? 'invalid_request' : 'not_found' });
        return true;
    }
    if (songMatch && req.method === 'POST' && body?.phase === 'confirm') {
        const quoteId = typeof body.quote_id === 'string' ? body.quote_id : '';
        const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
        if (!quoteId || !idempotencyKey) {
            send(res, 400, { error: !quoteId ? 'quote_id_invalid' : 'idempotency_key_invalid' });
            return true;
        }
        const replay = state.musicRemixConfirmations.get(idempotencyKey);
        if (replay) {
            send(res, replay.quoteId === quoteId ? 200 : 409,
                replay.quoteId === quoteId ? { ...replay.response, idempotent: true } : { error: 'idempotency_conflict' });
            return true;
        }
        const acceptedQuote = state.musicRemixQuotes.get(quoteId);
        if (!acceptedQuote || acceptedQuote.songId !== songMatch[1]) {
            send(res, 409, { error: 'quote_expired' });
            return true;
        }
        if (Date.parse(acceptedQuote.expires_at) <= Date.now()) {
            state.musicRemixQuotes.delete(quoteId);
            send(res, 409, { error: 'quote_expired' });
            return true;
        }
        if (acceptedQuote.usedBy) {
            send(res, 409, { error: 'quote_already_used' });
            return true;
        }
        if (state.balance < acceptedQuote.total_credits) {
            send(res, 402, { error: 'insufficient_credits' });
            return true;
        }
        const generationId = randomUUID();
        const jobs = [randomUUID(), randomUUID()];
        const candidates = jobs.map((job_id, index) => ({ ordinal: index + 1,
            label: index === 0 ? 'First variation' : 'Second variation', job_id, state: 'queued' }));
        state.musicRemixGenerations.set(generationId, {
            id: generationId, state: 'succeeded', model_id: acceptedQuote.model_id, prompt: acceptedQuote.prompt,
            title: null, created_at: new Date().toISOString(), total_credits: acceptedQuote.total_credits,
            candidates: jobs.map((job_id, index) => ({ ordinal: index + 1,
                label: index === 0 ? 'First variation' : 'Second variation', state: 'ready', job_id,
                song_id: randomUUID(), version_id: randomUUID(), error_code: null,
                audio_url: `/api/v1/jobs/${job_id}/asset` })),
        });
        for (const [index, job_id] of jobs.entries()) state.jobs.push({ id: job_id,
            model_id: acceptedQuote.model_id, credits: acceptedQuote.credits_per_candidate, created: Date.now() - 10_000,
            label: candidates[index].label, kind: 'music' });
        state.balance -= acceptedQuote.total_credits;
        acceptedQuote.usedBy = idempotencyKey;
        const response = { generation_id: generationId, state: 'queued', balance_after: state.balance, candidates };
        state.musicRemixConfirmations.set(idempotencyKey, { quoteId, response });
        send(res, 202, response);
        return true;
    }
    const generationMatch = path.match(/^\/api\/v1\/music\/generations\/([0-9a-f-]+)$/i);
    if (generationMatch && req.method === 'GET') {
        const generation = state.musicRemixGenerations.get(generationMatch[1]);
        send(res, generation ? 200 : 404, generation ?? { error: 'not_found' });
        return true;
    }
    return false;
}

export const mockMusicRemixSongId = PRIMARY_SONG_ID;
