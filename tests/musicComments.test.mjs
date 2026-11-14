import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseMusicCommentReview, parseMusicCommentWrite, publicMusicComments } from '../lib/musicComments.js';
import { musicRuntimeFlag } from '../lib/musicRuntime.js';

// Track comments (0518, song page parity slice 3): every comment waits for an administrator.
const sql = readFileSync(new URL('../packages/db/schema/supabase/0518_music_comments.sql', import.meta.url), 'utf8');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const KEY = 'comment.123e4567-e89b-42d3-a456-426614174000';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const SLUG = 'abcdefabcdefabcdefabcdef';

test('a comment, a withdrawal or a report is parsed; anything else is refused', () => {
    assert.deepEqual(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: '  Love it  ', at_seconds: 12.34, idempotency_key: KEY }),
        { ok: true, idempotencyKey: KEY, payload: { action: 'submit', slug: SLUG, body: 'Love it', at_seconds: 12.3 } });
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: 'x', parent_id: ID.toUpperCase(), idempotency_key: KEY }).payload.parent_id, ID);
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: '   ', idempotency_key: KEY }).error, 'body_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: 'x'.repeat(1001), idempotency_key: KEY }).error, 'body_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: 'x', at_seconds: 601, idempotency_key: KEY }).error, 'at_seconds_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: 'x', html: true, idempotency_key: KEY }).error, 'invalid_request');
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: 'short', body: 'x', idempotency_key: KEY }).error, 'slug_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'submit', slug: SLUG, body: 'x' }).error, 'idempotency_key_invalid');
    assert.deepEqual(parseMusicCommentWrite({ action: 'withdraw', comment_id: ID, idempotency_key: KEY }).payload, { action: 'withdraw', comment_id: ID });
    assert.equal(parseMusicCommentWrite({ action: 'withdraw', comment_id: ID, details: 'x', idempotency_key: KEY }).error, 'comment_id_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'report', comment_id: ID, category: 'spam', details: 'advert', idempotency_key: KEY }).ok, true);
    assert.equal(parseMusicCommentWrite({ action: 'report', comment_id: ID, category: 'bad', details: 'advert', idempotency_key: KEY }).error, 'category_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'report', comment_id: ID, category: 'spam', details: 'x', idempotency_key: KEY }).error, 'details_invalid');
    assert.equal(parseMusicCommentWrite({ action: 'delete', comment_id: ID, idempotency_key: KEY }).error, 'invalid_request');
});

test('an administrator decision is parsed; a report resolution carries no decision', () => {
    assert.deepEqual(parseMusicCommentReview({ action: 'review_comment', id: ID, decision: 'approved', reason: ' fine ' }).payload,
        { action: 'review_comment', id: ID, decision: 'approved', reason: 'fine' });
    assert.equal(parseMusicCommentReview({ action: 'review_comment', id: ID, decision: 'deleted', reason: 'fine' }).error, 'decision_invalid');
    assert.equal(parseMusicCommentReview({ action: 'resolve_report', id: ID, reason: 'done' }).ok, true);
    assert.equal(parseMusicCommentReview({ action: 'resolve_report', id: ID, decision: 'approved', reason: 'done' }).error, 'action_invalid');
    assert.equal(parseMusicCommentReview({ action: 'review_comment', id: ID, decision: 'approved', reason: 'no' }).error, 'reason_invalid');
    assert.equal(parseMusicCommentReview({ action: 'review_comment', id: ID, decision: 'approved', reason: 'fine', extra: 1 }).error, 'body_invalid');
});

test('the public projection never carries pending comments; own comments only for the viewer', () => {
    const result = { allow_comments: true, next_cursor: 'nope', comments: [{ id: ID, body: 'hi', author: 'Listener', at_seconds: '12.5', is_creator: 'yes', user_id: 'secret' }],
        own_comments: [{ id: ID, body: 'mine', status: 'pending' }] };
    const anon = publicMusicComments(result);
    assert.deepEqual(Object.keys(anon).sort(), ['allow_comments', 'comments', 'next_cursor']);
    assert.equal(anon.next_cursor, null);
    assert.equal(anon.comments[0].at_seconds, 12.5);
    assert.equal(anon.comments[0].is_creator, false);
    assert.equal(anon.comments[0].user_id, undefined);
    assert.equal(publicMusicComments(result, { viewer: true }).own_comments[0].status, 'pending');
});

test('comments ship off behind their own switch', () => {
    assert.equal(musicRuntimeFlag('comments', { MUSIC_RUNTIME_FLAGS: '{}' }), false);
    assert.equal(musicRuntimeFlag('comments', { MUSIC_RUNTIME_FLAGS: '{"comments":true}' }), true);
    const flags = read('../wrangler.jsonc').match(/MUSIC_RUNTIME_FLAGS"\s*:\s*"([^"]*)"/g) || [];
    for (const line of flags) assert.doesNotMatch(line, /\\"comments\\":true/);
});

test('every comment is held for review and only approved ones are read publicly', () => {
    assert.match(sql, /status TEXT NOT NULL DEFAULT 'pending'/);
    assert.match(sql, /WHERE c\.publication_id = v_pub\.id AND c\.status = 'approved'/);
    assert.match(sql, /IF NOT v_pub\.allow_comments THEN RETURN jsonb_build_object\('ok', false, 'code', 'COMMENTS_CLOSED'\)/);
    assert.match(sql, /v_comment\.author_id = v_admin OR v_pub_owner = v_admin THEN RETURN jsonb_build_object\('ok', false, 'code', 'SELF_REVIEW'\)/);
    assert.match(sql, /status = 'pending'\) >= 5 THEN[\s\S]{0,80}'LIMIT_REACHED'/);
});

test('the new tables are locked down and every function revokes and grants by full signature', () => {
    assert.ok(sql.includes("FOREACH t IN ARRAY ARRAY['music_comments', 'music_comment_reports', 'music_comment_mutations'] LOOP"));
    for (const step of ['ENABLE ROW LEVEL SECURITY', 'FORCE ROW LEVEL SECURITY', 'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated']) assert.ok(sql.includes(step), step);
    for (const fn of ['music_comment_mutate(TEXT,TEXT,JSONB)', 'music_comments_read(TEXT,TEXT,UUID)', 'music_comment_review_list(TEXT)', 'music_comment_review(TEXT,TEXT,JSONB)']) {
        assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated`), fn);
        assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role`), fn);
    }
    for (const block of sql.split(/CREATE OR REPLACE FUNCTION/).slice(1)) assert.match(block, /SET search_path = ''/);
});

test('comments are erased with the account and classified in the deletion and export checks', () => {
    for (const table of ['music_comments', 'music_comment_reports', 'music_comment_mutations']) {
        assert.ok(read('../scripts/test-account-deletion.mjs').includes(`'${table}'`), table);
        assert.ok(read('../scripts/test-privacy-export.mjs').includes(`'${table}'`), table);
    }
    assert.match(sql, /CREATE TRIGGER users_music_comments_forget_erased/);
});

test('comment text is rendered as text, never HTML', () => {
    for (const file of readdirSync(new URL('../app/veyrnox/_components/music/', import.meta.url)).filter((f) => /Comment/.test(f))) {
        assert.doesNotMatch(read(`../app/veyrnox/_components/music/${file}`), /dangerouslySetInnerHTML/);
    }
    assert.doesNotMatch(read('../app/veyrnox/app/admin/music-comments/page.js'), /dangerouslySetInnerHTML/);
});

test('the routes read identity only from the middleware header and the admin route uses the admin gate', () => {
    const route = read('../app/api/v1/music/comments/route.js');
    assert.match(route, /request\.headers\.get\('x-veyrnox-auth-id'\)/);
    assert.doesNotMatch(route.replace(/x-veyrnox-auth-id/g, ''), /x-veyrnox-/);
    assert.match(read('../app/api/v1/admin/music-comments/route.js'), /await adminGate\(req\)/);
    assert.match(read('../app/api/music/public/[slug]/route.js'), /music_comments_read', \{ p_slug: slug, p_auth_id: null/);
});
