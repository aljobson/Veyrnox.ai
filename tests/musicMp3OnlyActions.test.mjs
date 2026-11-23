import test from 'node:test';
import assert from 'node:assert/strict';

// Actions follow the current asset facts. Historical operation/provider fields
// cannot predict the format after a local render or provider copy.

process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ ui: true, schema: true, library: true, generation: true, dispatch: true, editing: true, stems: true, trackAdd: true, targetStems: true });
const { GET } = await import('../app/api/v1/music/songs/[id]/route.js');

const SONG = '123e4567-e89b-42d3-a456-426614174000';
const USER_ID = '223e4567-e89b-42d3-a456-426614174000';
async function songFor(mime_type, size_bytes, operation = 'generation') {
    const real = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ ok: true, song: { id: SONG, actions: [], current_version: { operation, mime_type, size_bytes } } });
    try {
        const res = await GET(new Request('https://x.invalid', { headers: { 'x-veyrnox-auth-id': USER_ID } }), { params: Promise.resolve({ id: SONG }) });
        assert.equal(res.status, 200);
        return await res.json();
    } finally { globalThis.fetch = real; }
}

test('legacy song projections keep pre-migration action availability', async () => {
    const song = await songFor(undefined, undefined, 'cover');
    assert.ok(song.actions.includes('render'));
    assert.ok(song.actions.includes('crop'));
    assert.ok(song.actions.includes('stems'));
    assert.ok(song.actions.includes('add_track'));
    assert.ok(song.actions.includes('target_stem'));
});

test('an MPEG version offers Stems and Track add regardless of operation', async () => {
    const song = await songFor('audio/mpeg', 10_485_760, 'generation');
    const actions = song.actions;
    assert.ok(actions.includes('stems'));
    assert.ok(actions.includes('add_track'));
    assert.equal(actions.includes('render'), false);
    assert.equal(song.current_version.capabilities.track_add, true);
});

test('a canonical WAV offers local edits and target stems but not MP3-only actions', async () => {
    const song = await songFor('audio/wav', 26_214_400, 'cover');
    assert.equal(song.actions.includes('stems'), false);
    assert.equal(song.actions.includes('add_track'), false);
    assert.ok(song.actions.includes('target_stem'));
    assert.ok(song.actions.includes('render'));
    assert.ok(song.actions.includes('crop'));
});

test('an oversized WAV hides local PCM actions', async () => {
    const song = await songFor('audio/wav', 26_214_401, 'crop');
    assert.equal(song.actions.includes('render'), false);
    assert.equal(song.actions.includes('crop'), false);
});
