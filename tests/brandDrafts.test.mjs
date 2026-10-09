import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_DRAFTS, NETWORK_MEDIA, batchIdFor, captionFor, isRunWindow, isoWeekKey, mediaTypeOf, planDrafts, runBrandDrafts,
} from '../lib/social/brandDrafts.js';

const OWNER = '11111111-2222-4333-8444-555555555555';
const BRAND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MONDAY_6 = new Date('2026-10-05T06:02:00Z');
const models = [{ id: 'wan-2.5-kie', title: 'Wan 2.5' }, { id: 'nano-banana-kie', title: 'Nano Banana' }];
const accounts = [{ id: 'acc-ig', network: 'instagram' }, { id: 'acc-yt', network: 'youtube' }, { id: 'acc-x', network: 'twitter' }];

test('limited release skips weekly drafts before database access', async () => {
    const saved = process.env.PUBLISH_RELEASED_NETWORKS;
    process.env.PUBLISH_RELEASED_NETWORKS = 'youtube';
    try {
        const result = await runBrandDrafts({ publishOn: true, db: {
            select() { throw new Error('must not read drafts'); },
            rpc() { throw new Error('must not create drafts'); },
        } });
        assert.deepEqual(result, { ok: true, skipped: 'limited_network_release' });
    } finally {
        if (saved === undefined) delete process.env.PUBLISH_RELEASED_NETWORKS;
        else process.env.PUBLISH_RELEASED_NETWORKS = saved;
    }
});

test('ISO weeks and the Monday 06:00 UTC run window', () => {
    assert.equal(isoWeekKey(new Date('2026-10-05T00:00:00Z')), '2026-W41');
    assert.equal(isoWeekKey(new Date('2026-01-01T12:00:00Z')), '2026-W01');
    assert.equal(isoWeekKey(new Date('2027-01-01T12:00:00Z')), '2026-W53');
    assert.equal(isRunWindow(MONDAY_6), true);
    assert.equal(isRunWindow(new Date('2026-10-05T07:00:00Z')), false);
    assert.equal(isRunWindow(new Date('2026-10-06T06:00:00Z')), false);
});

test('a week has one stable batch id per owner', async () => {
    const a = await batchIdFor(OWNER, '2026-W41');
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(await batchIdFor(OWNER, '2026-W41'), a);
    assert.notEqual(await batchIdFor(OWNER, '2026-W42'), a);
    assert.notEqual(await batchIdFor('99999999-2222-4333-8444-555555555555', '2026-W41'), a);
});

test('media types, network support and captions', () => {
    assert.equal(mediaTypeOf('image/png'), 'image');
    assert.equal(mediaTypeOf('video/mp4'), 'video');
    assert.equal(mediaTypeOf('audio/mpeg'), null);
    assert.equal(NETWORK_MEDIA.youtube, 'video');
    assert.equal(captionFor(models[0]), 'Made with Wan 2.5 on Veyrnox.ai. veyrnox.ai/models/wan-2.5-kie');
});

test('plans one draft a day, targets only accounts that take the media, and skips the rest', () => {
    const jobs = [
        { id: 'j-video', model_id: 'wan-2.5-kie', mime_type: 'video/mp4' },
        { id: 'j-image', model_id: 'nano-banana-kie', mime_type: 'image/png' },
        { id: 'j-hidden', model_id: 'auto-short', mime_type: 'video/mp4' },
        { id: 'j-audio', model_id: 'wan-2.5-kie', mime_type: 'audio/mpeg' },
        { id: 'j-done', model_id: 'nano-banana-kie', mime_type: 'image/png' },
    ];
    const plans = planDrafts({ jobs, models, accounts, alreadyDrafted: new Set(['j-done']), now: MONDAY_6 });
    assert.deepEqual(plans.map((p) => [p.jobId, p.accountIds, p.scheduledAt]), [
        ['j-video', ['acc-yt'], '2026-10-06T16:00:00.000Z'],
        ['j-image', ['acc-ig', 'acc-x'], '2026-10-07T16:00:00.000Z'],
    ]);
    assert.equal(plans[0].idempotencyKey, 'auto-j-video');
    assert.equal(plans[1].text, captionFor(models[1]));
});

test('never plans more than MAX_DRAFTS, and nothing without a matching account', () => {
    const jobs = Array.from({ length: MAX_DRAFTS + 3 }, (_, i) => ({ id: `j${i}`, model_id: 'nano-banana-kie', mime_type: 'image/png' }));
    assert.equal(planDrafts({ jobs, models, accounts, now: MONDAY_6 }).length, MAX_DRAFTS);
    assert.equal(planDrafts({ jobs, models, accounts: [{ id: 'acc-yt', network: 'youtube' }], now: MONDAY_6 }).length, 0);
});

function fakeDb(tables = {}) {
    const calls = [];
    return {
        calls,
        select: async (table, q) => { calls.push(['select', table, q.filter]); return (tables[table] || (() => []))(q); },
        rpc: async (name, args) => {
            calls.push(['rpc', name, args]);
            if (name === 'get_or_create_default_social_brand') return { ok: true, brand_id: BRAND };
            if (name === 'create_social_post_draft') return { ok: true, idempotent: false, post_id: `p-${args.p_idempotency_key}` };
            throw new Error(`unexpected rpc ${name}`);
        },
    };
}
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'k' };
const base = { cfg, ownerAuthId: OWNER, publishOn: true, loadModels: async () => models, now: MONDAY_6 };

test('off unless Publish is on, the owner is configured, and it is the run window', async () => {
    const db = fakeDb();
    assert.equal((await runBrandDrafts({ ...base, publishOn: false, db })).skipped, 'publish_disabled');
    assert.equal((await runBrandDrafts({ ...base, ownerAuthId: undefined, db })).skipped, 'not_configured');
    assert.equal((await runBrandDrafts({ ...base, ownerAuthId: 'not-a-uuid', db })).skipped, 'not_configured');
    assert.equal((await runBrandDrafts({ ...base, cfg: {}, db })).skipped, 'not_configured');
    assert.equal((await runBrandDrafts({ ...base, now: new Date('2026-10-05T09:00:00Z'), db })).skipped, 'not_run_window');
    assert.equal(db.calls.length, 0, 'no database call when off');
});

test('a week whose batch already exists is a no-op', async () => {
    const db = fakeDb({ social_posts: () => [{ id: 'x' }] });
    const out = await runBrandDrafts({ ...base, db });
    assert.equal(out.skipped, 'already_ran');
    assert.equal(out.batchId, await batchIdFor(OWNER, '2026-W41'));
    assert.equal(db.calls.some((c) => c[0] === 'rpc'), false);
});

test('creates one draft per eligible job in this week\'s batch, with encoded filters', async () => {
    let postsQuery = 0;
    const db = fakeDb({
        social_posts: () => (postsQuery++ === 0 ? [] : [{ idempotency_key: 'auto-j2' }]),
        users: () => [{ id: 'user-1' }],
        social_accounts: () => accounts,
        jobs: () => [{ id: 'j1', model_id: 'wan-2.5-kie' }, { id: 'j2', model_id: 'nano-banana-kie' }, { id: 'j3', model_id: 'nano-banana-kie' }, { id: 'j4', model_id: 'nano-banana-kie' }],
        assets: () => [{ job_id: 'j1', mime_type: 'video/mp4' }, { job_id: 'j2', mime_type: 'image/png' }, { job_id: 'j3', mime_type: 'image/png' }],
    });
    const out = await runBrandDrafts({ ...base, db });
    const batchId = await batchIdFor(OWNER, '2026-W41');
    assert.deepEqual(out, { ok: true, created: 2, planned: 2, errors: [], batchId });
    const drafts = db.calls.filter((c) => c[1] === 'create_social_post_draft').map((c) => c[2]);
    assert.deepEqual(drafts.map((d) => [d.p_idempotency_key, d.p_account_ids, d.p_batch_id, d.p_media[0].media_type]), [
        ['auto-j1', ['acc-yt'], batchId, 'video'],
        ['auto-j3', ['acc-ig', 'acc-x'], batchId, 'image'],
    ]);
    const jobsFilter = db.calls.find((c) => c[1] === 'jobs')[2];
    assert.match(jobsFilter, /created_at=gte\.2026-09-28T06%3A02%3A00\.000Z/);
    assert.match(jobsFilter, /state=eq\.STORED/);
});

test('a failed draft is reported, not thrown', async () => {
    const db = fakeDb({
        users: () => [{ id: 'user-1' }], social_accounts: () => accounts,
        jobs: () => [{ id: 'j1', model_id: 'nano-banana-kie' }], assets: () => [{ job_id: 'j1', mime_type: 'image/png' }],
    });
    db.rpc = async (name) => (name === 'create_social_post_draft' ? { ok: false, code: 'MEDIA_NOT_FOUND' } : { ok: true, brand_id: BRAND });
    const out = await runBrandDrafts({ ...base, db });
    assert.equal(out.ok, false);
    assert.deepEqual(out.errors, ['MEDIA_NOT_FOUND']);
});
