import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MUSIC_REACTIONS, parseMusicSocialWrite, publicMusicSocial } from '../lib/musicSocial.js';
import { musicRuntimeFlag } from '../lib/musicRuntime.js';

// Song reactions and creator follows (0515, song page parity slice 1).
const sql = readFileSync(new URL('../packages/db/schema/supabase/0515_music_reactions_and_follows.sql', import.meta.url), 'utf8');
const KEY = 'react.123e4567-e89b-42d3-a456-426614174000';

test('a reaction or a follow write is parsed; anything else is refused', () => {
    assert.deepEqual(parseMusicSocialWrite({ slug: 'abcdefabcdefabcdefabcdef', reaction: 'fire', idempotency_key: KEY }),
        { ok: true, kind: 'reaction', slug: 'abcdefabcdefabcdefabcdef', reaction: 'fire', idempotencyKey: KEY });
    assert.equal(parseMusicSocialWrite({ slug: 'abcdefabcdefabcdefabcdef', reaction: null, idempotency_key: KEY }).reaction, null);
    assert.equal(parseMusicSocialWrite({ handle: 'some_creator', following: true, idempotency_key: KEY }).kind, 'follow');
    assert.equal(parseMusicSocialWrite({ slug: 'abcdefabcdefabcdefabcdef', reaction: 'nope', idempotency_key: KEY }).error, 'reaction_invalid');
    assert.equal(parseMusicSocialWrite({ slug: 'short', reaction: 'fire', idempotency_key: KEY }).error, 'slug_invalid');
    assert.equal(parseMusicSocialWrite({ handle: 'Bad Handle', following: true, idempotency_key: KEY }).error, 'handle_invalid');
    assert.equal(parseMusicSocialWrite({ handle: 'some_creator', following: 'yes', idempotency_key: KEY }).error, 'following_invalid');
    assert.equal(parseMusicSocialWrite({ slug: 'abcdefabcdefabcdefabcdef', reaction: 'fire' }).error, 'idempotency_key_invalid');
    assert.equal(parseMusicSocialWrite({ slug: 'abcdefabcdefabcdefabcdef', reaction: 'fire', following: true, idempotency_key: KEY }).error, 'invalid_request');
});

test('the public projection carries counts only; viewer state only when asked', () => {
    const summary = { reactions: { fire: 2, love: '1', bogus: 9 }, follower_count: 3, my_reaction: 'fire', following: true, is_own: false };
    const anon = publicMusicSocial(summary);
    assert.deepEqual(Object.keys(anon).sort(), ['follower_count', 'reactions']);
    assert.equal(anon.reactions.fire, 2);
    assert.equal(anon.reactions.love, 1);
    assert.equal(anon.reactions.bogus, undefined);
    assert.equal(publicMusicSocial(summary, { viewer: true }).my_reaction, 'fire');
});

test('the SQL and JS reaction lists match', () => {
    const list = sql.match(/reaction IN \(([^)]+)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(list, MUSIC_REACTIONS);
});

test('the tables are locked down, erased with the account, and skipped by the Music deletion guard', () => {
    for (const table of ['music_song_reactions', 'music_creator_follows', 'music_social_mutations']) {
        assert.match(sql, new RegExp(`'${table}'`));
        assert.match(sql, new RegExp(`DELETE FROM public\\.${table} WHERE`));
    }
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
    assert.match(sql, /r\.relname NOT IN \('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations'\)/);
    assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.users/);
    for (const fn of ['music_social_summary(TEXT,TEXT,TEXT)', 'music_set_song_reaction(TEXT,TEXT,TEXT,TEXT)', 'music_set_creator_follow(TEXT,TEXT,BOOLEAN,TEXT)']) {
        assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.replace(/[()]/g, '\\$&')} TO service_role`));
    }
});

test('the guard replacement changes only the excluded-table list', () => {
    const prior = readFileSync(new URL('../packages/db/schema/supabase/0493_music_reference_links.sql', import.meta.url), 'utf8');
    const pattern = /CREATE OR REPLACE FUNCTION private\.account_deletion_blockers[\s\S]*?END \$\$;/;
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const mine = sql.match(pattern)[0].replace("AND r.relname NOT IN ('music_reference_links', 'music_song_reactions', 'music_creator_follows', 'music_social_mutations')", "AND r.relname <> 'music_reference_links'");
    assert.equal(norm(mine).replace(/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS/, ''), norm(prior.match(pattern)[0]).replace(/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS/, ''));
});

test('both switches start off', () => {
    assert.equal(musicRuntimeFlag('reactions', { MUSIC_RUNTIME_FLAGS: '{}' }), false);
    assert.equal(musicRuntimeFlag('follows', { MUSIC_RUNTIME_FLAGS: '{}' }), false);
    assert.equal(musicRuntimeFlag('reactions', { MUSIC_RUNTIME_FLAGS: '{"reactions":true}' }), true);
});
