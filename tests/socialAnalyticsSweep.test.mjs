import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalyticsSweep, BATCH } from '../lib/socialAnalyticsSweep.js';
import { tokenCryptoConfig, encryptToken } from '../lib/social/tokenCrypto.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const now = new Date('2026-10-03T23:30:00Z');

async function account(overrides = {}) {
    return {
        account_id: 'a-1', network: 'instagram', external_account_id: 'ig-42',
        access_token_enc: await encryptToken('plain-token', cryptoCfg), ...overrides,
    };
}

async function withRpc(handlers, run) {
    const real = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        const args = JSON.parse(init.body);
        calls.push({ name, args });
        const handler = handlers[name];
        if (!handler) throw new Error(`unexpected rpc: ${name}`);
        return Response.json(await handler(args));
    };
    try { await run(calls); } finally { globalThis.fetch = real; }
}

test('refuses to run without a supabase config or a valid encryption key', async () => {
    assert.deepEqual(await runAnalyticsSweep({ cfg: {}, cryptoCfg }), { ok: false, skipped: 'not_configured' });
    assert.deepEqual(await runAnalyticsSweep({ cfg, cryptoCfg: null }), { ok: false, skipped: 'not_configured' });
});

test('claims only networks it has a fetcher for; nothing due is a clean no-op', async () => {
    await withRpc({ claim_social_analytics_accounts: async () => [] }, async (calls) => {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, fetchers: { instagram: async () => ({}) }, now });
        assert.deepEqual(out, { ok: true, claimed: 0, synced: 0, failed: 0, errors: 0 });
        assert.deepEqual(calls, [{ name: 'claim_social_analytics_accounts', args: { p_limit: BATCH, p_networks: ['instagram'] } }]);
    });
});

test('a failed claim is reported, not thrown', async () => {
    await withRpc({}, async () => {
        assert.deepEqual(await runAnalyticsSweep({ cfg, cryptoCfg, now }), { ok: false, error: 'claim_failed' });
    });
});

test('decrypts the token, fetches, and records the result under the UTC date', async () => {
    const row = await account();
    const seen = [];
    await withRpc({
        claim_social_analytics_accounts: async () => [row],
        record_social_analytics: async () => ({ ok: true, posts: 1 }),
    }, async (calls) => {
        const out = await runAnalyticsSweep({
            cfg, cryptoCfg, now,
            fetchers: { instagram: async (token, acct) => { seen.push([token, acct.account_id]); return { metrics: { followers: 9 }, posts: [{ id: 'm-1' }] }; } },
        });
        assert.deepEqual(out, { ok: true, claimed: 1, synced: 1, failed: 0, errors: 0 });
        assert.deepEqual(seen, [['plain-token', 'a-1']]);
        assert.deepEqual(calls[1], { name: 'record_social_analytics', args: {
            p_account_id: 'a-1', p_metric_date: '2026-10-03', p_metrics: { followers: 9 }, p_posts: [{ id: 'm-1' }],
        } });
    });
});

test('asks Instagram for insights only for an account that was granted the permission', async () => {
    const real = globalThis.fetch;
    const graph = [];
    const rows = [
        await account({ account_id: 'a-basic', scopes_granted: ['instagram_business_basic'] }),
        await account({ account_id: 'a-insights', scopes_granted: ['instagram_business_basic', 'instagram_business_manage_insights'] }),
    ];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        if (u.hostname === 'graph.instagram.com') {
            graph.push(u.pathname);
            return Response.json(u.pathname.endsWith('/media') ? { data: [] } : u.pathname.endsWith('/insights') ? { data: [] } : { followers_count: 1 });
        }
        const name = u.pathname.split('/').pop();
        return Response.json(name === 'claim_social_analytics_accounts' ? rows : { ok: true, posts: 0 });
    };
    try {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, now });
        assert.deepEqual(out, { ok: true, claimed: 2, synced: 2, failed: 0, errors: 0 });
        assert.deepEqual(graph, ['/v25.0/me', '/v25.0/me/media', '/v25.0/me', '/v25.0/me/media', '/v25.0/me/insights']);
    } finally { globalThis.fetch = real; }
});

test('one account failing is recorded on that account and does not stop the next', async () => {
    const rows = [await account({ account_id: 'a-bad' }), await account({ account_id: 'a-undecryptable', access_token_enc: '\\x00' }), await account({ account_id: 'a-good' })];
    await withRpc({
        claim_social_analytics_accounts: async () => rows,
        record_social_analytics_failure: async () => ({ ok: true }),
        record_social_analytics: async () => ({ ok: true, posts: 0 }),
    }, async (calls) => {
        const out = await runAnalyticsSweep({
            cfg, cryptoCfg, now,
            fetchers: { instagram: async (token, acct) => {
                if (acct.account_id === 'a-bad') throw new Error('Session has expired');
                return { metrics: {}, posts: [] };
            } },
        });
        assert.deepEqual(out, { ok: true, claimed: 3, synced: 1, failed: 2, errors: 0 });
        assert.deepEqual(calls[1], { name: 'record_social_analytics_failure', args: { p_account_id: 'a-bad', p_error: 'Session has expired' } });
        assert.equal(calls[2].name, 'record_social_analytics_failure');
        assert.equal(calls[2].args.p_account_id, 'a-undecryptable');
        assert.equal(calls[3].args.p_account_id, 'a-good');
    });
});

test('an account disconnected mid-fetch counts as failed; a report that throws counts as an error', async () => {
    const rows = [await account({ account_id: 'a-gone' }), await account({ account_id: 'a-db-down' })];
    await withRpc({
        claim_social_analytics_accounts: async () => rows,
        record_social_analytics: async (args) => {
            if (args.p_account_id === 'a-db-down') throw new Error('db down');
            return { ok: false, code: 'ACCOUNT_NOT_FOUND' };
        },
    }, async () => {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, now, fetchers: { instagram: async () => ({ metrics: {}, posts: [] }) } });
        assert.deepEqual(out, { ok: true, claimed: 2, synced: 0, failed: 1, errors: 1 });
    });
});

test('the default claim includes YouTube alongside Instagram', async () => {
    await withRpc({ claim_social_analytics_accounts: async () => [] }, async (calls) => {
        await runAnalyticsSweep({ cfg, cryptoCfg, now });
        assert.deepEqual(new Set(calls[0].args.p_networks), new Set(['instagram', 'youtube', 'tiktok']));
    });
});

test('YouTube refresh encrypts and persists the access token before analytics, preserving the refresh token', async () => {
    const { decryptToken } = await import('../lib/social/tokenCrypto.js');
    const row = await account({ network: 'youtube', token_expires_at: '2026-10-03T23:00:00Z', refresh_token_enc: await encryptToken('refresh-token', cryptoCfg) });
    const events = [];
    await withRpc({
        claim_social_analytics_accounts: async () => [row],
        update_social_account_token: async (args) => {
            events.push('persist');
            assert.equal(await decryptToken(args.p_access_token_enc, cryptoCfg), 'new-access');
            assert.equal(args.p_token_expires_at, '2026-10-04T00:30:00Z');
            assert.equal('p_refresh_token_enc' in args, false);
            return { ok: true };
        },
        record_social_analytics: async () => ({ ok: true }),
    }, async () => {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, now, youtubeCfg: { clientId: 'fixture', clientSecret: 'fixture' },
            refreshYoutube: async (config, token) => { assert.equal(token, 'refresh-token'); events.push('refresh'); return { accessToken: 'new-access', expiresAt: '2026-10-04T00:30:00Z' }; },
            fetchers: { youtube: async (token) => { assert.equal(token, 'new-access'); events.push('fetch'); return { metrics: { views: 20 }, posts: [] }; } },
        });
        assert.equal(out.synced, 1);
        assert.deepEqual(events, ['refresh', 'persist', 'fetch']);
    });
});

test('a still-valid YouTube token needs no refresh configuration or update', async () => {
    const row = await account({ network: 'youtube', token_expires_at: '2026-10-04T00:30:00Z' });
    await withRpc({ claim_social_analytics_accounts: async () => [row], record_social_analytics: async () => ({ ok: true }) }, async () => {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, now, youtubeCfg: null, fetchers: { youtube: async (token) => { assert.equal(token, 'plain-token'); return {}; } } });
        assert.equal(out.synced, 1);
    });
});

for (const failure of ['missing-refresh', 'missing-config', 'refresh-rejected', 'disconnected', 'persist-error']) {
    test(`YouTube ${failure} is recorded and does not stop the next account`, async () => {
        const row = await account({ network: 'youtube', token_expires_at: '2026-10-03T23:00:00Z', refresh_token_enc: failure === 'missing-refresh' ? null : await encryptToken('refresh', cryptoCfg) });
        const good = await account({ account_id: 'good', network: 'youtube', token_expires_at: '2026-10-04T00:30:00Z' });
        let fetched = 0;
        await withRpc({
            claim_social_analytics_accounts: async () => [row, good],
            update_social_account_token: async () => { if (failure === 'persist-error') throw new Error('db down'); return null; },
            record_social_analytics_failure: async (args) => { assert.equal(args.p_account_id, row.account_id); assert.ok(!args.p_error.includes('upstream private')); return { ok: true }; },
            record_social_analytics: async () => ({ ok: true }),
        }, async () => {
            const out = await runAnalyticsSweep({ cfg, cryptoCfg, now,
                youtubeCfg: failure === 'missing-config' ? null : {},
                refreshYoutube: async () => { if (failure === 'refresh-rejected') throw new Error('upstream private'); return { accessToken: 'new-access', expiresAt: '2026-10-04T00:30:00Z' }; },
                fetchers: { youtube: async () => { fetched++; return {}; } },
            });
            assert.equal(out.failed, 1);
            assert.equal(out.synced, 1);
            assert.equal(fetched, 1);
        });
    });
}

test('TikTok refresh atomically persists encrypted token pair, identity and actual scopes before fetching', async () => {
    const { decryptToken } = await import('../lib/social/tokenCrypto.js');
    const row = await account({ network: 'tiktok', external_account_id: 'open-1', scopes_granted: ['user.info.stats', 'video.list'],
        token_expires_at: '2026-10-03T23:00:00Z', refresh_token_enc: await encryptToken('old-refresh', cryptoCfg) });
    const events = [];
    await withRpc({
        claim_social_analytics_accounts: async () => [row],
        rotate_tiktok_account_tokens: async (args) => {
            events.push('persist');
            assert.equal(args.p_expected_access_token_enc, row.access_token_enc);
            assert.equal(args.p_expected_refresh_token_enc, row.refresh_token_enc);
            assert.equal(await decryptToken(args.p_access_token_enc, cryptoCfg), 'new-access');
            assert.equal(await decryptToken(args.p_refresh_token_enc, cryptoCfg), 'rotated-refresh');
            assert.deepEqual(args.p_scopes, ['video.list']);
            return { ok: true };
        }, record_social_analytics: async () => ({ ok: true }),
    }, async () => {
        const out = await runAnalyticsSweep({ cfg, cryptoCfg, now, tiktokCfg: {},
            refreshTiktok: async (_, token) => { events.push('refresh'); assert.equal(token, 'old-refresh');
                return { accessToken: 'new-access', refreshToken: 'rotated-refresh', expiresAt: '2026-10-04T23:30:00Z', externalAccountId: 'open-1', scopes: ['video.list'] }; },
            fetchers: { tiktok: async (token, acct) => { events.push('fetch'); assert.equal(token, 'new-access'); assert.deepEqual(acct.scopes_granted, ['video.list']); return {}; } },
        });
        assert.equal(out.synced, 1);
        assert.deepEqual(events, ['refresh', 'persist', 'fetch']);
    });
});

for (const failure of ['missing-grant', 'missing-refresh', 'missing-config', 'refresh-rejected', 'wrong-identity', 'disconnected']) {
    test(`TikTok ${failure} is isolated and never fetches with an unpersisted token`, async () => {
        const row = await account({ network: 'tiktok', scopes_granted: failure === 'missing-grant' ? [] : ['video.list'],
            token_expires_at: '2026-10-03T23:00:00Z', refresh_token_enc: failure === 'missing-refresh' ? null : await encryptToken('refresh', cryptoCfg) });
        const good = await account({ account_id: 'good', network: 'tiktok', scopes_granted: ['video.list'], token_expires_at: '2026-10-04T23:30:00Z' });
        let fetched = 0;
        await withRpc({ claim_social_analytics_accounts: async () => [row, good], rotate_tiktok_account_tokens: async () => null,
            record_social_analytics_failure: async (args) => { assert.equal(args.p_account_id, row.account_id); assert.ok(!args.p_error.includes('private')); return { ok: true }; },
            record_social_analytics: async () => ({ ok: true }),
        }, async () => {
            const out = await runAnalyticsSweep({ cfg, cryptoCfg, now, tiktokCfg: failure === 'missing-config' ? null : {},
                refreshTiktok: async () => { if (failure === 'refresh-rejected') throw new Error('private vendor response');
                    return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: '2026-10-04T23:30:00Z', externalAccountId: failure === 'wrong-identity' ? 'foreign' : row.external_account_id, scopes: ['video.list'] }; },
                fetchers: { tiktok: async () => { fetched++; return {}; } },
            });
            assert.equal(out.failed, 1); assert.equal(out.synced, 1); assert.equal(fetched, 1);
        });
    });
}
