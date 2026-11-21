import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { musicBlocksDatabase } from './test-support/music-blocks-bootstrap.ts';

const DATABASE_URL = process.env.DATABASE_URL;
const signature = '(text,uuid,uuid,text,text,boolean,boolean,text,text)';
const privateName = `private.music_publish_song_pre_0570${signature}`;
const publicName = `public.music_publish_song${signature}`;
const blocked = { ok: false, code: 'PUBLICATION_BLOCKED' };
describe('Music publication takedown (0576)', { skip: !DATABASE_URL && 'DATABASE_URL not set', concurrency: false }, () => {
    let db, isolated, pg, migration;
    const value = async (sql, args = [], client = db) => Object.values((await client.query(sql, args)).rows[0])[0];
    const call = (fn, args, client = db) => value(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args, client);
    async function signup() {
        const auth = randomUUID();
        await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
        const user = await value('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
        return { auth, user, handle: `c_${user.replaceAll('-', '')}`.slice(0, 29) };
    }
    async function song(u) {
        const song = randomUUID(), version = randomUUID(), key = randomUUID();
        assert.equal((await call('music_reserve_mixdown', [u.auth, song, version, randomUUID(), randomUUID(), key,
            'Takedown test track', 1920044, 'a'.repeat(64), 10, '[]', false, false])).ok, true);
        assert.equal((await call('music_commit_mixdown', [u.auth, key, version, 1920044, 'a'.repeat(64), 10])).ok, true);
        return { song, version, key: randomUUID() };
    }
    const publish = (u, track, changes = {}, client = db) => {
        const input = { ...track, handle: u.handle, display: 'Creator', comments: true, remixes: false, ...changes };
        return call('music_publish_song', [u.auth, input.song, input.version, input.handle, input.display,
            input.comments, input.remixes, 'test-takedown', input.key], client);
    };
    const takeDown = (slug, client = db) => client.query("UPDATE public.music_publications SET status='blocked' WHERE slug=$1", [slug]);
    // Compare complete rows, including timestamps and profile names, not just counts.
    async function snapshot(u, client = db) {
        const result = {};
        for (const table of ['music_publications', 'music_publication_attestations', 'music_creator_profiles', 'music_actors']) {
            result[table] = await value(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)
                FROM public.${table} t WHERE user_id=$1`, [u.user], client);
        }
        return result;
    }
    async function fixture() {
        const u = await signup(), track = await song(u), receipt = await publish(u, track);
        assert.equal(receipt.ok, true, JSON.stringify(receipt));
        assert.equal(receipt.idempotent, false);
        assert.match(receipt.publication.slug, /^[a-f0-9]{24}$/);
        return { u, track, receipt, slug: receipt.publication.slug };
    }
    before(async () => {
        isolated = await musicBlocksDatabase(DATABASE_URL);
        pg = (await import('pg')).default;
        db = new pg.Client({ connectionString: isolated.connectionString });
        await db.connect();
        migration = await readFile(new URL('./schema/supabase/0576_music_publish_respects_takedown.sql', import.meta.url), 'utf8');
    });
    after(async () => {
        try { if (db) await db.end(); }
        finally { if (isolated) await isolated.cleanup(); }
    });
    it('publishes normally and preserves wrapper minting for a brand-new creator', async () => {
        const u = await signup(), track = await song(u);
        assert.equal(await value('SELECT count(*)::int FROM public.music_actors WHERE user_id=$1', [u.user]), 0);
        assert.equal(await value('SELECT count(*)::int FROM public.music_creator_profiles WHERE user_id=$1', [u.user]), 0);
        const receipt = await publish(u, track);
        assert.equal(receipt.ok, true);
        assert.match(receipt.publication.slug, /^[a-f0-9]{24}$/);
        const actor = await value('SELECT public_id FROM public.music_actors WHERE user_id=$1', [u.user]);
        assert.match(actor, /^[0-9a-f-]{36}$/);
        assert.notEqual(actor, u.user);
    });
    it('refuses a fresh key without any writes; replay retains the slug and current blocked status', async () => {
        const { u, track, receipt, slug } = await fixture();
        await takeDown(slug);
        const before = await snapshot(u);
        assert.deepEqual(await publish(u, track, { key: randomUUID(), handle: `${u.handle.slice(0, 25)}_new`, display: 'Changed' }), blocked);
        assert.deepEqual(await snapshot(u), before);
        assert.deepEqual(await publish(u, track), { ...receipt, idempotent: true,
            publication: { ...receipt.publication, status: 'blocked' } });
        assert.deepEqual(await snapshot(u), before);
        assert.deepEqual(await call('music_unpublish_song', [u.auth, track.song, randomUUID()]), { ok: true, idempotent: true });
        assert.deepEqual(await snapshot(u), before);
        assert.deepEqual(await call('music_resolve_publication', [slug]), { ok: false, code: 'NOT_FOUND' });
        assert.equal((await publish(u, await song(u))).ok, true, 'another song by this owner is unaffected');
        const other = await signup();
        assert.equal((await publish(other, await song(other))).ok, true, 'another owner is unaffected');
    });
    it('refuses a new current version and permissions; old-key replay still validates the current version first', async () => {
        const { u, track, slug } = await fixture();
        await takeDown(slug);
        const version = randomUUID();
        const crop = await call('music_commit_rendered_wav_crop', [u.auth, track.song, track.version, version,
            randomUUID(), randomUUID(), `music-renders/${u.user}/${version}.wav`, 960044, 'b'.repeat(64), 0, 5, 10, 5, randomUUID()]);
        assert.equal(crop.ok, true, JSON.stringify(crop));
        const before = await snapshot(u);
        assert.deepEqual(await publish(u, track, { version, key: randomUUID(), comments: false, remixes: true, display: 'Changed' }), blocked);
        assert.deepEqual(await publish(u, track), { ok: false, code: 'NOT_FOUND' });
        assert.deepEqual(await snapshot(u), before);
    });
    async function connections(run) {
        const a = new pg.Client({ connectionString: isolated.connectionString });
        const b = new pg.Client({ connectionString: isolated.connectionString });
        try {
            await a.connect(); await b.connect();
            for (const c of [a, b]) await c.query("SET statement_timeout='10s'");
            await run(a, b);
        } finally {
            // Release either holder even if the other connection still has a queued query.
            await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]);
            await Promise.allSettled([a.end(), b.end()]);
        }
    }
    async function waitForLock(waiter, holder) {
        const deadline = Date.now() + 5000;
        do {
            if (await value('SELECT $2::int = ANY(pg_blocking_pids($1::int))', [waiter, holder])) return;
            await delay(25);
        } while (Date.now() < deadline);
        assert.fail('Expected the publication row lock to block the second connection');
    }
    it('waits for an in-flight takedown and refuses after commit without writing', async () => {
        const { u, track, slug } = await fixture();
        // Absence also proves the wrapper cannot mint an actor on refusal.
        await db.query('DELETE FROM public.music_actors WHERE user_id=$1', [u.user]);
        await connections(async (a, b) => {
            const aPid = await value('SELECT pg_backend_pid()', [], a), bPid = await value('SELECT pg_backend_pid()', [], b);
            await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            await takeDown(slug, a);
            const before = await snapshot(u, a);
            await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            // Attach the rejection handler immediately, including when a lock assertion fails.
            const pending = publish(u, track, { key: randomUUID(), display: 'Must not change' }, b)
                .then(result => ({ result }), error => ({ error }));
            await waitForLock(bPid, aPid);
            await a.query('COMMIT');
            const outcome = await pending;
            if (outcome.error) throw outcome.error;
            assert.deepEqual(outcome.result, blocked);
            await b.query('COMMIT');
            assert.deepEqual(await snapshot(u), before);
            assert.deepEqual(await call('music_resolve_publication', [slug]), { ok: false, code: 'NOT_FOUND' });
        });
    });
    it('a publish that commits first still leaves the subsequent takedown effective', async () => {
        const { u, track, slug } = await fixture();
        await connections(async (a, b) => {
            const aPid = await value('SELECT pg_backend_pid()', [], a), bPid = await value('SELECT pg_backend_pid()', [], b);
            await b.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            assert.equal((await publish(u, track, { key: randomUUID() }, b)).ok, true);
            await a.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            const pending = takeDown(slug, a).then(result => ({ result }), error => ({ error }));
            await waitForLock(aPid, bPid);
            await b.query('COMMIT');
            const outcome = await pending;
            if (outcome.error) throw outcome.error;
            assert.equal(outcome.result.rowCount, 1);
            await a.query('COMMIT');
        });
        assert.deepEqual(await call('music_resolve_publication', [slug]), { ok: false, code: 'NOT_FOUND' });
        const before = await snapshot(u);
        assert.deepEqual(await publish(u, track, { key: randomUUID() }), blocked);
        assert.deepEqual(await snapshot(u), before);
    });
    it('replays twice with the private body, public wrapper and grants intact', async () => {
        const definition = name => value('SELECT pg_get_functiondef($1::regprocedure)', [name]);
        const acl = name => value('SELECT proacl::text FROM pg_proc WHERE oid=$1::regprocedure', [name]);
        const originalWrapper = await definition(publicName), originalPrivate = await definition(privateName);
        const originalAcls = [await acl(privateName), await acl(publicName)];
        await db.query(migration); await db.query(migration);
        assert.equal(await definition(publicName), originalWrapper);
        assert.equal(await definition(privateName), originalPrivate);
        assert.deepEqual([await acl(privateName), await acl(publicName)], originalAcls);
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal(await value('SELECT has_function_privilege($1,$2,\'EXECUTE\')', [role, privateName]), false);
            assert.equal(await value('SELECT has_function_privilege($1,$2,\'EXECUTE\')', [role, publicName]), role === 'service_role');
        }
        for (const name of [privateName, publicName]) {
            assert.equal(await value(`SELECT EXISTS(SELECT 1 FROM pg_proc p,
                LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')`, [name]), false);
        }
        const source = await value('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure', [privateName]);
        const old = await readFile(new URL('./schema/supabase/0504_music_publish_slug_and_local_render_check.sql', import.meta.url), 'utf8');
        const oldBody = old.split("SET search_path='' AS $$")[1].split('$$;')[0];
        const addition = migration.slice(migration.indexOf('    -- Serialize'), migration.indexOf('    IF EXISTS(SELECT 1 FROM public.music_creator_profiles'));
        assert.ok(addition.includes('PUBLICATION_BLOCKED'));
        assert.equal(source.replace(addition, ''), oldBody, 'all existing implementation bytes are preserved');
        const { u, track, slug } = await fixture();
        await takeDown(slug);
        assert.deepEqual(await publish(u, track, { key: randomUUID() }), blocked);
    });
});
