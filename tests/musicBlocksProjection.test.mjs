import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicMusicRail } from '../lib/musicRails.js';
import { publicBestOf } from '../lib/musicLyrics.js';
import { publicMusicComments } from '../lib/musicComments.js';
import { musicActorField, publicMusicCreator } from '../lib/musicActors.js';
import { telemetryPattern } from '../lib/telemetry.js';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const row = { slug: 'a'.repeat(24), handle: 'creator', title: 'Pop', display_name: 'Creator' };
const sql = await readFile(new URL('../packages/db/schema/supabase/0570_music_user_blocks.sql', import.meta.url), 'utf8');

test('all public actor allowlists validate UUID strings and preserve the old shape when absent', () => {
    for (const id of [ACTOR, undefined, 'invalid', [ACTOR], {}, 42]) {
        const field = id === ACTOR ? { creator_id: ACTOR } : {};
        assert.deepEqual(musicActorField(id), field);
        assert.deepEqual(publicMusicCreator({ ...row, creator_id: id }), { ...row, ...field });
        assert.deepEqual(publicMusicRail([{ ...row, creator_id: id, user_id: 'secret' }])[0], { ...row, ...field });
        assert.deepEqual(publicBestOf({ playlists: [{ genre: 'pop', tracks: [{ ...row, creator_id: id }] }] })[0].tracks[0], { ...row, ...field });
        const c = publicMusicComments({ comments: [{ author_id: id, author: 'Listener', user_id: 'secret' }] }).comments[0];
        assert.equal(c.author_id, id === ACTOR ? ACTOR : undefined); assert.equal(c.user_id, undefined);
    }
});

test('all five SQL projections select opaque ids; every read remains STABLE', () => {
    for (const name of ['music_resolve_publication', 'music_read_public_profile', 'music_public_rails', 'music_best_of_playlists', 'music_comments_read']) {
        const fn = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
        assert.ok(fn, name); assert.match(fn, /STABLE/); assert.match(fn, /private\.music_actor_field/); assert.doesNotMatch(fn, /private\.music_actor_id\(/);
    }
    for (const fn of sql.matchAll(/CREATE OR REPLACE FUNCTION (?:public|private)\.([^\s(]+)\([^]*?\$\$;/g)) {
        if (/for_viewer$|^music_(actor_field|actor_blocked|visible_tracks|list_blocked_actors)$/.test(fn[1])) assert.match(fn[0], /STABLE/);
    }
    assert.match(sql, /ON CONFLICT DO NOTHING/);
    assert.match(sql, /REVOKE ALL ON public\.music_actors, public\.music_user_blocks FROM PUBLIC, anon, authenticated, service_role/);
    assert.doesNotMatch(sql, /GRANT[^;]*TO (?:anon|authenticated)/);
    assert.match(sql, /pg_advisory_xact_lock\(570,/);
    assert.match(sql, /count\(\*\) FROM public\.music_user_blocks WHERE blocker_id=v_me\)>=500/);
});

test('new routes stay inside gateway, anonymous routes do not read identity, flags ship off', async () => {
    for (const path of ['blocks', 'blocks/[actorId]', 'explore/best-of', 'explore/tracks/[slug]', 'explore/creators/[handle]']) {
        const route = await readFile(new URL(`../app/api/v1/music/${path}/route.js`, import.meta.url), 'utf8');
        assert.match(route, /force-dynamic/); assert.match(route, /Handler/);
    }
    for (const path of ['public/[slug]', 'profiles/[handle]', 'best-of']) {
        const route = await readFile(new URL(`../app/api/music/${path}/route.js`, import.meta.url), 'utf8');
        assert.doesNotMatch(route, /x-veyrnox-/);
    }
    const flags = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    assert.equal((flags.match(/\\"blocks\\":false/g) || []).length, 2);
    for (const file of ['test-account-deletion.mjs', 'test-privacy-export.mjs']) {
        const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
        assert.match(source, /'music_actors'/); assert.match(source, /'music_user_blocks'/);
    }
});

test('telemetry uses normalized identity-free routes while retaining the prior allowlist', () => {
    for (const [path, normalized] of [
        [`/api/v1/music/blocks/${ACTOR}`, '/api/v1/music/blocks/:id'],
        ['/api/v1/music/explore/tracks/' + row.slug, '/api/v1/music/explore/tracks/:id'],
        ['/api/v1/music/explore/creators/' + row.handle, '/api/v1/music/explore/creators/:id'],
        ['/api/v1/music/explore/best-of', '/api/v1/music/explore/best-of'],
    ]) {
        assert.equal(telemetryPattern(path), normalized);
        assert.ok(sql.includes(`'${normalized}'`));
    }
    assert.match(sql, /OR public\.telemetry_path_allowed_pre_0570\(p_path\)/);
});
