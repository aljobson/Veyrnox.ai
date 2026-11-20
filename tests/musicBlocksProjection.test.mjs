import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
        const result = { comments: [{ author_id: id, author: 'Listener', user_id: 'secret' }] };
        assert.equal(Object.hasOwn(publicMusicComments(result).comments[0], 'author_id'), false);
        const c = publicMusicComments(result, { viewer: true }).comments[0];
        assert.equal(c.author_id, id === ACTOR ? ACTOR : undefined); assert.equal(c.user_id, undefined);
    }
});

test('creator and viewer comment projections select opaque ids; every read remains STABLE', () => {
    for (const name of ['music_resolve_publication', 'music_read_public_profile', 'music_public_rails', 'music_best_of_playlists', 'music_comments_read_for_viewer']) {
        const fn = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
        assert.ok(fn, name); assert.match(fn, /STABLE/); assert.match(fn, /private\.music_actor_field/); assert.doesNotMatch(fn, /private\.music_actor_id\(/);
    }
    const anonymous = sql.match(/CREATE OR REPLACE FUNCTION public\.music_comments_read\([^]*?\$\$;/)[0];
    assert.match(anonymous, /STABLE/);
    assert.doesNotMatch(anonymous, /private\.music_actor_(field|id)/);
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

// Match complete dollar-quoted function definitions, including named delimiters.
const publicWrites = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(music_publish_song|music_comment_mutate)\s*\([^]*?\bAS\s+(\$(?:[a-z_][a-z_0-9]*)?\$)([^]*?)\2/gi;
function assertActorMinting(source, filename) {
    const uncommented = source.replace(/--[^\n]*|\/\*[^]*?\*\//g, '');
    for (const fn of uncommented.matchAll(publicWrites)) {
        assert.match(fn[3], /\bprivate\.music_actor_id\s*\(/i, `${filename}: ${fn[1]} must preserve actor minting; change the private *_pre_0570 implementation instead`);
    }
}

test('later migrations preserve actor minting when replacing public Music write wrappers', async () => {
    for (const path of ['../packages/db/schema/', '../packages/db/schema/supabase/']) {
        const directory = new URL(path, import.meta.url);
        for (const file of (await readdir(directory)).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) > 570)) {
            assertActorMinting(await readFile(new URL(file, directory), 'utf8'), file);
        }
    }
});

test('wrapper guard rejects missing or commented-out minting in either function', () => {
    for (const name of ['music_publish_song', 'music_comment_mutate']) {
        const prefix = `CREATE OR REPLACE FUNCTION public.${name}() RETURNS JSONB LANGUAGE plpgsql AS $body$ BEGIN `;
        assert.throws(() => assertActorMinting(`${prefix} RETURN '{}'; END $body$;`, 'fixture'), /must preserve actor minting/);
        assert.throws(() => assertActorMinting(`${prefix} -- private.music_actor_id(user);\n RETURN '{}'; END $body$;`, 'fixture'), /must preserve actor minting/);
        assertActorMinting(`${prefix} PERFORM private.music_actor_id(user); END $body$;`, 'fixture');
    }
});
