import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicRpcStatus, publicMusicError } from '../lib/musicBackend.js';
import { POST } from '../app/api/v1/music/songs/[id]/publication/route.js';

const id = '11111111-1111-4111-8111-111111111111';
test('publication takedown has a typed forbidden response', () => {
    assert.equal(musicRpcStatus('PUBLICATION_BLOCKED'), 403);
    assert.equal(publicMusicError('PUBLICATION_BLOCKED'), 'publication_blocked');
    assert.equal(publicMusicError('database error: secret'), 'music_request_rejected');
});

test('publication POST surfaces only the typed takedown code', async (t) => {
    const names = ['MUSIC_RUNTIME_FLAGS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
    t.after(() => {
        for (const name of names) {
            if (original[name] === undefined) delete process.env[name];
            else process.env[name] = original[name];
        }
    });
    process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ schema: true, library: true, distribution: true, publication: true });
    process.env.SUPABASE_URL = 'https://example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
        const method = new URL(url).pathname.split('/').at(-1);
        calls.push(method);
        if (method === 'music_get_publication_context') return Response.json({ ok: true, title: 'Harbour lights', prompt: 'Piano' });
        assert.equal(method, 'music_publish_song');
        return Response.json({ ok: false, code: 'PUBLICATION_BLOCKED', detail: 'private DB detail', stack: 'private stack' });
    });
    const response = await POST(new Request(`https://example.invalid/api/v1/music/songs/${id}/publication`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-veyrnox-auth-id': id },
        body: JSON.stringify({ version_id: id, handle: 'creator', display_name: 'Creator', allow_comments: false,
            allow_remixes: false, rights_confirmed: true, idempotency_key: 'publish.test-key' }),
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'publication_blocked' });
    assert.deepEqual(calls, ['music_get_publication_context', 'music_publish_song']);
});

test('takedown changes only the private implementation by adding the serialized refusal', async () => {
    const read = name => readFile(new URL(`../packages/db/schema/supabase/${name}`, import.meta.url), 'utf8');
    const old = await read('0504_music_publish_slug_and_local_render_check.sql');
    const migration = await read('0576_music_publish_respects_takedown.sql');
    const oldBody = old.split("SET search_path='' AS $$")[1].split('$$;')[0];
    const newBody = migration.split("SET search_path='' AS $$")[1].split('$$;')[0];
    const addition = `    -- Serialize with moderation UPDATEs, including an in-flight takedown.
    PERFORM 1 FROM public.music_publications WHERE song_id=p_song_id FOR UPDATE;
    -- A separate statement observes the committed status at READ COMMITTED.
    IF EXISTS(SELECT 1 FROM public.music_publications WHERE song_id=p_song_id AND status='blocked') THEN
        RETURN jsonb_build_object('ok',false,'code','PUBLICATION_BLOCKED');
    END IF;
`;
    assert.ok(newBody.includes(addition));
    assert.equal(newBody.replace(addition, ''), oldBody);
    assert.ok(newBody.indexOf(addition) > newBody.indexOf("'slug',v_existing.slug"), 'replay branch stays first');
    assert.ok(newBody.indexOf(addition) < newBody.indexOf('INSERT INTO public.music_creator_profiles'), 'refusal precedes writes');
    assert.match(migration, /CREATE OR REPLACE FUNCTION private\.music_publish_song_pre_0570\(/);
    assert.doesNotMatch(migration, /(?:FUNCTION public\.|GRANT\s)/);
    assert.match(migration, /REVOKE ALL ON FUNCTION private\.music_publish_song_pre_0570\(TEXT,UUID,UUID,TEXT,TEXT,BOOLEAN,BOOLEAN,TEXT,TEXT\) FROM PUBLIC, anon, authenticated, service_role;/);
});

test('takedown trigger propagates only to live siblings and has no caller grants', async () => {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0576_music_publish_respects_takedown.sql', import.meta.url), 'utf8');
    const trigger = migration.split('CREATE OR REPLACE FUNCTION private.music_block_publication_siblings()')[1];
    assert.ok(trigger);
    assert.match(trigger, /RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS \$\$/);
    assert.match(trigger, /UPDATE public\.music_publications SET status='blocked',updated_at=now\(\)\s+WHERE song_id=NEW\.song_id AND status='published';/);
    assert.match(trigger, /REVOKE ALL ON FUNCTION private\.music_block_publication_siblings\(\) FROM PUBLIC, anon, authenticated, service_role;/);
    assert.match(trigger, /DROP TRIGGER IF EXISTS music_block_publication_siblings ON public\.music_publications;/);
    assert.match(trigger, /AFTER INSERT OR UPDATE OF status ON public\.music_publications\s+FOR EACH ROW WHEN \(NEW\.status='blocked'\)\s+EXECUTE FUNCTION private\.music_block_publication_siblings\(\);/);
    assert.doesNotMatch(trigger, /\bGRANT\b/);
    const afterFunction = trigger.split('END $$;')[1];
    assert.doesNotMatch(afterFunction, /(?:^|;)\s*(?:UPDATE|INSERT|DELETE)\b/mi, 'migration performs no data cleanup');
});

for (const status of ['blocked', 'published']) {
    test(`dialog handles a successful ${status} receipt and clears its attempt key`, async () => {
        const source = await readFile(new URL('../app/veyrnox/_components/music/MusicPublicationDialog.jsx', import.meta.url), 'utf8');
        // Execute the actual submit handler without a browser or a JSX dependency.
        const handler = source.slice(source.indexOf('  async function publish()'), source.indexOf('  async function unpublish()'));
        assert.ok(handler.startsWith('  async function publish()'));
        const publication = { slug: 'a'.repeat(24), status };
        const state = { busy: false, error: 'previous error', notice: 'previous notice', publication: null };
        const notices = [], requests = [], attemptRef = { current: 'publish.original-retry' };
        let keysMinted = 0;
        const scope = {
            rights: true, busy: false, attemptRef, song: { id, version_id: id },
            handle: 'creator', displayName: 'Creator', comments: false, remixes: false,
            key: () => `publish.fresh-${++keysMinted}`,
            t: name => { assert.equal(name, 'music.publication.blocked'); return 'Taken down message'; },
            gatewayFetch: async (url, options) => {
                assert.equal(url, `/music/songs/${id}/publication`);
                assert.equal(options.method, 'POST');
                requests.push(JSON.parse(options.body));
                return { publication };
            },
            setBusy: value => { state.busy = value; },
            setError: value => { state.error = value; },
            setNotice: value => { state.notice = value; notices.push(value); },
            setPublication: value => { state.publication = value; },
        };
        const publish = new Function(...Object.keys(scope), `${handler}\nreturn publish;`)(...Object.values(scope));
        await publish();
        assert.equal(requests[0].idempotency_key, 'publish.original-retry');
        assert.equal(attemptRef.current, null);
        assert.equal(state.publication, publication);
        assert.equal(state.busy, false, 'finally must run even after the blocked early return');
        if (status === 'blocked') {
            assert.equal(state.error, 'Taken down message');
            assert.deepEqual(notices, [''], 'a blocked receipt must never announce Published');
        } else {
            assert.equal(state.error, '');
            assert.match(state.notice, /^Published\./);
        }
        await publish();
        assert.equal(requests[1].idempotency_key, 'publish.fresh-1');
        assert.equal(attemptRef.current, null);
    });
}
