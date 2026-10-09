import test from 'node:test';
import assert from 'node:assert/strict';
import { runPublishSweep } from '../lib/socialPublishSweep.js';
import { renewExtendedToken } from '../lib/social/extendedTokens.js';
import { encryptToken, decryptToken, tokenCryptoConfig } from '../lib/social/tokenCrypto.js';
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-test' };
const cryptoCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') });
const r2cfg = { accountId: 'acct', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' };
const targetId = '11111111-1111-4111-8111-111111111111';
const deps = { cfg, cryptoCfg, r2cfg };
async function target(state = {}) {
    return { target_id: targetId, account_id: 'account', external_account_id: '12345', network: 'facebook', claim_key: 'claim',
        access_token_enc: await encryptToken('page-token', cryptoCfg), media_type: 'image', r2_key: 'assets/image.jpg', global_text: 'Test', provider_state: state };
}
test('native submission is marked before the public request and its result is checkpointed before completion', async () => {
    const row = await target(), order = []; let saved;
    globalThis.fetch = async (url, init) => {
        const u = new URL(url), name = u.pathname.split('/').pop();
        order.push(name);
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        if (name === 'mark_social_provider_submission') return Response.json({ ok: true });
        if (name === 'photos') return Response.json({ post_id: '12345_67890' });
        if (name === 'report_social_post_progress') { saved = JSON.parse(init.body).p_provider_state; return Response.json({ ok: true }); }
        if (name === 'complete_social_post_target') { assert.equal(JSON.parse(init.body).p_platform_post_id, '12345_67890'); return Response.json({ ok: true }); }
        throw new Error(`unexpected request ${name}`);
    };
    assert.equal((await runPublishSweep(deps)).published, 0);
    assert.deepEqual(order, ['claim_due_social_post_targets', 'mark_social_provider_submission', 'photos', 'report_social_post_progress']);
    assert.equal(saved.result.platformPostId, '12345_67890');
    row.provider_state = saved; order.length = 0;
    assert.equal((await runPublishSweep(deps)).published, 1);
    assert.deepEqual(order, ['claim_due_social_post_targets', 'complete_social_post_target']);
});
test('an uncertain previous submission fails for reconciliation without another provider call', async () => {
    const row = await target({ submission_started: true });
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        if (name === 'claim_due_social_post_targets') return Response.json([row]);
        assert.equal(name, 'complete_social_post_target');
        assert.equal(JSON.parse(init.body).p_error, 'provider_result_unknown_reconcile_before_retry');
        return Response.json({ ok: true });
    };
    assert.equal((await runPublishSweep(deps)).failed, 1);
});
test('new token rotation persists encrypted pairs before returning access, and refuses stale rotation', async () => {
    const account = { account_id: 'a', external_account_id: 'board', network: 'pinterest', token_expires_at: new Date(0).toISOString(),
        access_token_enc: await encryptToken('old-access', cryptoCfg), refresh_token_enc: await encryptToken('old-refresh', cryptoCfg) };
    const env = { PINTEREST_CLIENT_ID: 'client123', PINTEREST_CLIENT_SECRET: 'secret-test' };
    let allowed = true;
    globalThis.fetch = async (url, init) => {
        if (new URL(url).hostname === 'api.pinterest.com') return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
        const body = JSON.parse(init.body);
        assert.equal(body.p_expected_access_token_enc, account.access_token_enc);
        assert.equal(await decryptToken(body.p_access_token_enc, cryptoCfg), 'new-access');
        assert.equal(await decryptToken(body.p_refresh_token_enc, cryptoCfg), 'new-refresh');
        return Response.json(allowed ? { ok: true } : null);
    };
    assert.equal(await renewExtendedToken(account, 'old-access', { cfg, cryptoCfg, env }), 'new-access');
    allowed = false;
    await assert.rejects(renewExtendedToken(account, 'old-access', { cfg, cryptoCfg, env }), /token_rotation_lost/);
});
