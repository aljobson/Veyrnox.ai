import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { musicBlocksDatabase } from './test-support/music-blocks-bootstrap.ts';

const DATABASE_URL = process.env.DATABASE_URL;
describe('Music actor identities and blocks (0570)', { skip: !DATABASE_URL && 'DATABASE_URL not set', concurrency: false }, () => {
    let db, isolated, migration, alice, bob, creator, listener, fresh, track, second, otherTrack, comment;
    const q = (sql, args = []) => db.query(sql, args);
    const one = async (sql, args = []) => (await q(sql, args)).rows[0];
    const value = async (sql, args = []) => Object.values(await one(sql, args))[0];
    const call = (fn, ...args) => value(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
    const actor = u => value('SELECT public_id FROM public.music_actors WHERE user_id=$1', [u.user]);
    async function signup() {
        const auth = randomUUID();
        await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
        return { auth, user: await value('SELECT id FROM public.users WHERE auth_id=$1', [auth]) };
    }
    async function publish(u, handle = `c_${u.user.replaceAll('-', '')}`.slice(0, 29), display = 'Creator') {
        const song = randomUUID(), version = randomUUID(), job = randomUUID(), asset = randomUUID(), key = randomUUID();
        const reserve = await call('music_reserve_mixdown', u.auth, song, version, job, asset, key, 'Pop ambient track', 1920044, 'a'.repeat(64), 10, '[]', false, false);
        assert.equal(reserve.ok, true, JSON.stringify(reserve));
        assert.equal((await call('music_commit_mixdown', u.auth, key, version, 1920044, 'a'.repeat(64), 10)).ok, true);
        const result = await call('music_publish_song', u.auth, song, version, handle, display, true, false, 'test-music-blocks', randomUUID());
        assert.equal(result.ok, true, JSON.stringify(result));
        return { song, version, slug: result.publication.slug, handle };
    }
    async function submit(u, slug, body = 'A listener comment') {
        const r = await call('music_comment_mutate', u.auth, randomUUID(), { action: 'submit', slug, body });
        assert.equal(r.ok, true, JSON.stringify(r));
        return r.id;
    }
    before(async () => {
        isolated = await musicBlocksDatabase(DATABASE_URL);
        const pg = (await import('pg')).default;
        db = new pg.Client({ connectionString: isolated.connectionString }); await db.connect();
        await q('BEGIN');
        alice = await signup(); bob = await signup(); creator = await signup(); listener = await signup();
        track = await publish(creator); second = await publish(creator); otherTrack = await publish(bob);
        comment = await submit(listener, track.slug);
        await q("UPDATE public.music_comments SET status='approved' WHERE id=$1", [comment]);
        // Model people predating 0570; replay must backfill both identities without a read writing.
        await q('DELETE FROM public.music_actors WHERE user_id=ANY($1::uuid[])', [[creator.user, listener.user]]);
        assert.equal((await call('music_resolve_publication', track.slug)).track.creator_id, undefined);
        assert.equal((await call('music_comments_read', track.slug, null, null)).comments[0].author_id, undefined);
        migration = await readFile(new URL('./schema/supabase/0570_music_user_blocks.sql', import.meta.url), 'utf8');
        await q(migration); await q(migration);
        fresh = await signup(); const freshTrack = await publish(fresh);
        const newcomer = await signup(); await submit(newcomer, freshTrack.slug);
        assert.ok(await actor(newcomer), 'non-creator commenter minted at submit');
        assert.notEqual(await actor(listener), listener.user);
        assert.notEqual(await actor(creator), creator.user);
        await q('COMMIT');
        // Real read-only transaction, matching PostgREST's read execution contract.
        await q('BEGIN READ ONLY');
        for (const slug of [track.slug, freshTrack.slug]) {
            assert.equal((await call('music_resolve_publication', slug)).ok, true);
            assert.equal((await call('music_comments_read', slug, alice.auth, null)).ok, true);
            assert.equal((await call('music_comments_read_for_viewer', slug, alice.auth, null)).ok, true);
            assert.equal((await call('music_resolve_publication_for_viewer', alice.auth, slug)).ok, true);
            assert.equal((await call('music_public_rails', slug)).ok, true);
            assert.equal((await call('music_public_rails_for_viewer', alice.auth, slug)).ok, true);
        }
        for (const handle of [track.handle, freshTrack.handle]) {
            assert.equal((await call('music_read_public_profile', handle)).ok, true);
            assert.equal((await call('music_read_public_profile_for_viewer', alice.auth, handle)).ok, true);
        }
        assert.equal((await call('music_best_of_playlists')).ok, true);
        assert.equal((await call('music_best_of_playlists_for_viewer', alice.auth)).ok, true);
        assert.ok(Array.isArray((await call('music_list_blocked_actors', alice.auth)).blocks));
        await q('ROLLBACK'); await q('BEGIN');
    });
    after(async () => {
        try { if (db) { try { await q('ROLLBACK'); } finally { await db.end(); } } }
        finally { if (isolated) await isolated.cleanup(); }
    });
    it('mints one opaque id across creator/commenter names and repeated publication writes', async () => {
        const id = await actor(creator), listenerId = await actor(listener);
        const update = await call('music_publish_song', creator.auth, track.song, track.version, 'renamed_creator', 'New name', true, false, 'test-music-blocks', randomUUID());
        assert.equal(update.ok, true); track.handle = 'renamed_creator';
        assert.equal(await actor(creator), id);
        assert.equal((await call('music_resolve_publication', track.slug)).track.creator_id, id);
        const profile = await call('music_read_public_profile', track.handle);
        assert.equal(profile.profile.creator_id, id); assert.ok(profile.tracks.every(t => t.creator_id === id));
        await publish(listener, 'listener_now_creator', 'New listener name');
        assert.equal(await actor(listener), listenerId);
        const comments = await call('music_comments_read', track.slug, null, null);
        assert.equal(comments.comments[0].author_id, listenerId); assert.equal(comments.comments[0].author, 'New listener name');
        await q(migration); assert.equal(await actor(creator), id); assert.equal(await actor(listener), listenerId);
    });
    it('block/unblock are idempotent, reject self and unknown actors, list only opaque ids', async () => {
        const id = await actor(creator);
        assert.deepEqual(await call('music_block_actor', alice.auth, id), { ok: true, already: false });
        assert.deepEqual(await call('music_block_actor', alice.auth, id), { ok: true, already: true });
        const blocks = (await call('music_list_blocked_actors', alice.auth)).blocks;
        assert.equal(blocks.length, 1); assert.equal(blocks[0].actor_id, id); assert.equal(blocks[0].display_name, 'New name');
        assert.deepEqual(Object.keys(blocks[0]).sort(), ['actor_id', 'created_at', 'display_name']);
        assert.equal((await call('music_block_actor', creator.auth, id)).error, 'cannot_block_self');
        for (const fn of ['music_block_actor', 'music_unblock_actor']) {
            assert.equal((await call(fn, alice.auth, randomUUID())).error, 'user_not_found');
            assert.equal((await call(fn, randomUUID(), id)).error, 'account_not_found');
        }
        assert.deepEqual(await call('music_unblock_actor', alice.auth, id), { ok: true, already: false });
        assert.deepEqual(await call('music_unblock_actor', alice.auth, id), { ok: true, already: true });
    });
    it('filters creators from best-of, rails, profile and track, with per-viewer isolation and recovery', async () => {
        const id = await actor(creator);
        assert.equal((await call('music_resolve_publication_for_viewer', alice.auth, track.slug)).track.creator_id, id);
        assert.ok((await call('music_best_of_playlists_for_viewer', alice.auth)).playlists.some(p => p.tracks.some(t => t.creator_id === id)));
        await call('music_block_actor', alice.auth, id);
        for (const [fn, target] of [['music_resolve_publication_for_viewer', track.slug], ['music_read_public_profile_for_viewer', track.handle]]) {
            assert.deepEqual(await call(fn, alice.auth, target), { ok: true, blocked: { creator_id: id, display_name: 'New name' } });
            assert.equal((await call(fn, bob.auth, target)).ok, true);
            assert.equal((await call(fn, creator.auth, target)).blocked, undefined);
        }
        const best = await call('music_best_of_playlists_for_viewer', alice.auth);
        assert.ok(best.playlists.every(p => p.tracks.every(t => t.creator_id !== id)));
        const rails = await call('music_public_rails_for_viewer', alice.auth, track.slug);
        assert.deepEqual(rails.by_creator, []);
        const similar = await call('music_public_rails_for_viewer', alice.auth, otherTrack.slug);
        assert.ok(similar.similar.every(t => t.creator_id !== id));
        assert.equal((await call('music_resolve_publication', track.slug)).track.creator_id, id, 'anonymous read unchanged');
        await call('music_unblock_actor', alice.auth, id);
        assert.equal((await call('music_resolve_publication_for_viewer', alice.auth, track.slug)).track.creator_id, id);
        assert.ok((await call('music_public_rails_for_viewer', alice.auth, track.slug)).by_creator.some(t => t.slug === second.slug));
        assert.ok((await call('music_best_of_playlists_for_viewer', alice.auth)).playlists.some(p => p.tracks.some(t => t.creator_id === id)));
    });
    it('filters before comment pagination and keeps own pending/rejected rows', async () => {
        const id = await actor(listener);
        const own = await submit(alice, track.slug, 'Own pending');
        const pub = await value('SELECT id FROM public.music_publications WHERE slug=$1', [track.slug]);
        await q(`INSERT INTO public.music_comments(author_id,publication_id,body,status,created_at)
            SELECT $1,$2,'blocked comment','approved',now()+i*interval '1 second' FROM generate_series(1,30) i`, [listener.user, pub]);
        await call('music_block_actor', alice.auth, id);
        const result = await call('music_comments_read_for_viewer', track.slug, alice.auth, null);
        assert.deepEqual(result.comments, []); assert.equal(result.next_cursor, null);
        assert.equal(result.own_comments[0].id, own);
        assert.equal((await call('music_comments_read_for_viewer', track.slug, bob.auth, null)).comments.length, 25);
        assert.equal((await call('music_comments_read_for_viewer', track.slug, listener.auth, null)).comments.length, 25);
        assert.equal((await call('music_comments_read', track.slug, null, null)).comments.length, 25);
        await call('music_unblock_actor', alice.auth, id);
        const visible = await call('music_comments_read_for_viewer', track.slug, alice.auth, null);
        assert.equal(visible.comments.length, 25); assert.ok(visible.next_cursor);
        assert.equal((await call('music_comments_read_for_viewer', track.slug, alice.auth, visible.next_cursor)).comments.length, 6);
    });
    it('caps new blocks at 500 but permits replay and unblock at the cap', async () => {
        const owner = await signup(); const targets = [];
        for (let i = 0; i < 501; i++) {
            const u = await signup(); targets.push(await value('SELECT private.music_actor_id($1)', [u.user]));
        }
        for (const id of targets.slice(0, 500)) assert.equal((await call('music_block_actor', owner.auth, id)).already, false);
        assert.equal((await call('music_block_actor', owner.auth, targets[500])).error, 'block_limit');
        assert.equal((await call('music_block_actor', owner.auth, targets[0])).already, true);
        assert.equal((await call('music_unblock_actor', owner.auth, targets[0])).already, false);
        assert.equal((await call('music_block_actor', owner.auth, targets[500])).already, false);
    });
    it('erases actor mappings and both directions of blocks through account erasure', async () => {
        const erased = await signup(), other = await signup();
        const id = await value('SELECT private.music_actor_id($1)', [erased.user]);
        const otherId = await value('SELECT private.music_actor_id($1)', [other.user]);
        await call('music_block_actor', erased.auth, otherId); await call('music_block_actor', other.auth, id);
        assert.deepEqual(await value('SELECT private.account_deletion_blockers($1,$2)', [erased.user, erased.auth]), []);
        const token = await call('prepare_account_deletion', erased.auth);
        assert.equal(token.eligible, true, JSON.stringify(token));
        const result = await call('erase_account', erased.auth, token.confirmation_token);
        assert.ok(!result.error, JSON.stringify(result));
        assert.equal(await value('SELECT count(*)::int FROM public.music_actors WHERE user_id=$1', [erased.user]), 0);
        assert.equal(await value('SELECT count(*)::int FROM public.music_user_blocks WHERE blocker_id=$1 OR blocked_id=$1', [erased.user]), 0);
        assert.equal((await call('music_block_actor', other.auth, id)).error, 'user_not_found');
        assert.equal((await call('music_list_blocked_actors', erased.auth)).error, 'account_not_found');
        assert.equal(await value('SELECT private.music_actor_id($1)', [erased.user]), null);
        await q(migration); assert.equal(await value('SELECT count(*)::int FROM public.music_actors WHERE user_id=$1', [erased.user]), 0);
    });
    it('pins search_path, keeps reads stable and exposes RPCs only to service_role', async () => {
        const signatures = [...migration.matchAll(/GRANT EXECUTE ON FUNCTION ([^(]+\([^;]*?\)) TO service_role;/g)].map(m => m[1]);
        for (const signature of signatures) {
            const proc = await one('SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [signature]);
            assert.equal(proc.prosecdef, true, signature); assert.ok(proc.proconfig.includes('search_path=""'), signature);
            if (/for_viewer|music_(resolve_publication|read_public_profile|public_rails|best_of_playlists|comments_read|list_blocked_actors|actor_field|actor_blocked|visible_tracks)\(/.test(signature)) assert.equal(proc.provolatile, 's', signature);
            for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await value('SELECT has_function_privilege($1,$2,\'EXECUTE\')', [role, signature]), role === 'service_role', `${role} ${signature}`);
        }
        for (const table of ['music_actors', 'music_user_blocks']) {
            assert.deepEqual(await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]), { relrowsecurity: true, relforcerowsecurity: true });
            for (const role of ['anon', 'authenticated', 'service_role']) {
                for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(await value('SELECT has_table_privilege($1,$2,$3)', [role, `public.${table}`, privilege]), false);
            }
        }
        for (const role of ['anon', 'authenticated']) {
            await q('SAVEPOINT denied');
            try { await q(`SET LOCAL ROLE ${role}`); await assert.rejects(call('music_list_blocked_actors', alice.auth), e => e.code === '42501'); }
            finally { await q('ROLLBACK TO SAVEPOINT denied'); }
        }
        await q('SAVEPOINT service');
        try { await q('SET LOCAL ROLE service_role'); assert.ok(Array.isArray((await call('music_list_blocked_actors', alice.auth)).blocks)); }
        finally { await q('ROLLBACK TO SAVEPOINT service'); }
    });
});
