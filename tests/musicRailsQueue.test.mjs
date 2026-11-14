import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { musicRailsEnabled, publicMusicRail } from '../lib/musicRails.js';

// Song page parity slice 2: rails (0516) and a cross-page listening queue.
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sql = read('packages/db/schema/supabase/0516_music_public_rails.sql');

test('a rail keeps only public, well-formed rows and at most six', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ slug: `${'a'.repeat(23)}${i}`, title: 'T', handle: 'some_creator', display_name: 'C', user_id: 'secret', job_id: 'secret' }));
    const out = publicMusicRail([{ slug: 'bad', handle: 'x' }, ...rows]);
    assert.equal(out.length, 6);
    assert.deepEqual(Object.keys(out[0]).sort(), ['display_name', 'handle', 'slug', 'title']);
    assert.deepEqual(publicMusicRail(null), []);
});

test('the rails are read-only, published-only and service-role only', () => {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/);
    assert.match(sql, /p\.status = 'published'/);
    assert.match(sql, /s\.status = 'active'/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_public_rails\(TEXT\) TO service_role/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.music_public_rails\(TEXT\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /SET search_path = ''/);
    for (const built of sql.match(/jsonb_build_object\('slug'[^)]*\)/g)) {
        assert.equal(built, "jsonb_build_object('slug', t.slug, 'title', t.title, 'handle', t.handle, 'display_name', t.display_name)");
    }
});

test('the switch starts off', () => {
    assert.equal(musicRailsEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"schema":true,"library":true,"distribution":true,"publication":true}' }), false);
    assert.equal(musicRailsEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"schema":true,"library":true,"distribution":true,"publication":true,"rails":true}' }), true);
});

test('the queue lives in the layout, behind the switch, and stores only public fields in this tab', () => {
    const layout = read('app/veyrnox/layout.js');
    assert.match(layout, /<MusicQueueProvider enabled=\{musicRailsEnabled\(\)\}>/);
    const queue = read('app/veyrnox/_components/music/MusicQueue.jsx');
    assert.match(queue, /sessionStorage/);
    assert.doesNotMatch(queue, /localStorage/);
    assert.match(queue, /src=\{`\/api\/music\/public\/\$\{current\.slug\}\/asset`\}/);
    assert.match(queue, /\{enabled \? <MusicPlayerBar \/> : null\}/);
});
