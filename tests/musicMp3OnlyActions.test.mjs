import test from 'node:test';
import assert from 'node:assert/strict';

// Stems and Track add send the source to Mureka, which takes MP3 only, and the only
// Music version stored as MP3 is a Cover. The song route offers them on a Cover
// version and nowhere else, so the menu never shows an action whose quote always
// answers format_unavailable.

process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ ui: true, schema: true, library: true, generation: true, dispatch: true, editing: true, stems: true, trackAdd: true, targetStems: true });
const { GET } = await import('../app/api/v1/music/songs/[id]/route.js');

const SONG = '123e4567-e89b-42d3-a456-426614174000';
const AUTH = '223e4567-e89b-42d3-a456-426614174000';
async function actionsFor(operation) {
    const real = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ ok: true, song: { id: SONG, actions: [], current_version: { operation } } });
    try {
        const res = await GET(new Request('https://x.invalid', { headers: { 'x-veyrnox-auth-id': AUTH } }), { params: Promise.resolve({ id: SONG }) });
        assert.equal(res.status, 200);
        return (await res.json()).actions;
    } finally { globalThis.fetch = real; }
}

test('a Cover version offers Stems and Track add', async () => {
    const actions = await actionsFor('cover');
    assert.ok(actions.includes('stems'));
    assert.ok(actions.includes('add_track'));
});

for (const operation of ['generation', 'extend', 'replace_section', 'add_section', 'crop', undefined]) {
    test(`a ${operation ?? 'missing'} version hides Stems and Track add but keeps Target stems`, async () => {
        const actions = await actionsFor(operation);
        assert.equal(actions.includes('stems'), false);
        assert.equal(actions.includes('add_track'), false);
        assert.ok(actions.includes('target_stem'));
    });
}
