import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('production keeps fail-closed fal rollout flags out of Worker bindings', () => {
    for (const name of [
        'FAL_SUBMIT_OUTCOME_ENABLED',
        'FAL_DISPATCH_SCHEMA_ENABLED',
        'FAL_DURABLE_DISPATCH_ENABLED',
        'FAL_DISPATCH_QUEUE_ENABLED',
    ]) {
        assert.equal(Object.hasOwn(config.vars, name), false, `${name} should be omitted while disabled`);
    }
});

test('production public variables retain Cloudflare text-binding headroom', () => {
    // The 2026-10-16 deploy had 81 public vars plus 48 secrets: 129 text
    // bindings against Cloudflare's 128 limit. Capping vars at 77 leaves three
    // free slots at that same secret footprint and forces future consolidation.
    // ADR-0145 moved nine Cinema switches into CINEMA_RUNTIME_FLAGS (66 vars to 58); the cap is now 60, so the next
    // Cinema flag goes into that JSON object, not into a new var.
    // 2026-10-24: ADR-0256 adds SUPPLIER_ROUTES_SHADOW and SUPPLIER_ROUTES_ENABLED (59 to 61 vars). The live Worker has 50 secrets,
    // so 61 vars is 111 text bindings against the 128 limit (17 free), more headroom than the three this cap was set to keep. Cap 62.
    // ADR-0262 adds the frozen work order's standalone carousel switch: 63 vars,
    // at the recorded 50-secret footprint, 113 bindings with 15 slots remaining.
    // ADR-0309 adds MULTI_REFERENCE_ENABLED: 64 vars, 114 bindings at the 50-secret footprint (14 free). Cap 64.
    // ADR-0308/0311 turn on REQUIRE_AAL2_WHEN_ENROLLED (enrolled-2FA enforcement) now that the sign-in step-up and
    // recovery path have shipped: 65 vars, 115 bindings at the 50-secret footprint (13 free). Cap 65.
    // ADR-0316: SUBSCRIPTION_TRIAL_ENABLED turned on in production (owner, 2026-11-01): 66 vars, 116 bindings at the 50-secret footprint (12 free). Cap 66.
    // ACCOUNT_DELETION_ENABLED is a production *secret* binding (ADR-0111 amendment 2); a var of the same name replaces it
    // and fails deploy-production's secret preservation check, so it must never appear here.
    // Music replaces the redundant false MAX_CHARGE_ENABLED binding with one consolidated runtime object (67).
    // At the recorded 50-secret footprint that is 117 text bindings, leaving 11 of 128 slots.
    // PR #1993: Cloudflare refused a deploy at 131 text bindings (limit 128), so AI edit and Speech Cut add NO binding:
    // their switches and the model id live inside EDITOR_RUNTIME_FLAGS, and the speech webhook correlation reuses FAL_KEY.
    assert.ok(Object.keys(config.vars).length <= 67, 'production vars must not grow: the Worker is at its 128 text-binding cap');
    for (const vars of [config.vars, config.env.staging.vars]) {
        for (const name of ['EDITOR_AI_EDIT_ENABLED', 'EDITOR_AI_EDIT_MODEL_ID', 'SPEECH_CUT_ENABLED', 'SPEECH_CUT_WEBHOOK_SECRET']) {
            assert.ok(!Object.hasOwn(vars, name), `${name} must not be a separate binding`);
        }
    }
    assert.ok(!Object.hasOwn(config.vars, 'ACCOUNT_DELETION_ENABLED'), 'ACCOUNT_DELETION_ENABLED is a production secret, not a var');
    // ADR-0251 amendment (2026-10-29): CREATOR_PROFILE_ENABLED is also a production secret binding.
    assert.ok(!Object.hasOwn(config.vars, 'CREATOR_PROFILE_ENABLED'), 'CREATOR_PROFILE_ENABLED is a production secret, not a var');
});

test('daily check-in is on in production and accepts only explicit boolean strings elsewhere', () => {
    for (const vars of [config.vars, config.env.staging.vars]) {
        if (Object.hasOwn(vars, 'CHECKIN_ENABLED')) assert.ok(['true', 'false'].includes(vars.CHECKIN_ENABLED));
    }
    // ADR-0257: enabled in production by the owner on 2026-10-24. Removing the line turns it off.
    assert.equal(config.vars.CHECKIN_ENABLED, 'true');
});

test('store billing production switches are secrets and sandbox crediting is forbidden (ADR-0108)', () => {
    for (const name of ['STORE_BILLING_ENABLED', 'STORE_SALES_ENABLED', 'REVENUECAT_WEBHOOK_SECRET', 'STORE_BILLING_ALLOW_SANDBOX']) {
        assert.equal(Object.hasOwn(config.vars, name), false, `${name} must not be a production var (ADR-0108)`);
    }
});

test('maximum-charge enforcement ships disabled pending capped durable admission', () => {
    assert.equal(config.vars.MAX_CHARGE_ENABLED, undefined);
    assert.equal(config.env.staging.vars.MAX_CHARGE_ENABLED, undefined);
});

test('production Music is wired through one binding, with the seven editing actions on (0511)', () => {
    const flags = JSON.parse(config.vars.MUSIC_RUNTIME_FLAGS);
    for (const name of [
        'ui', 'schema', 'library', 'generation', 'dispatch', 'sources', 'distribution',
        'publication', 'editing', 'playlists', 'studio', 'reuse', 'collaboration',
    ]) assert.equal(flags[name], true, name);
    assert.equal(flags.references, false, 'provider reference-link ingestion stays closed');
    assert.equal(JSON.parse(config.env.staging.vars.MUSIC_RUNTIME_FLAGS).references, false, 'provider reference-link ingestion stays closed in staging');
    // Proven by billed staging runs on 2026-11-13/14; their catalog rows are activated by 0511.
    const stagingFlags = JSON.parse(config.env.staging.vars.MUSIC_RUNTIME_FLAGS);
    for (const name of ['cover', 'stems', 'targetStems', 'trackAdd', 'extend', 'replace', 'addSection']) {
        assert.equal(flags[name], true, name);
        assert.equal(stagingFlags[name], true, `staging ${name}`);
    }
    for (const name of ['MUSIC_UI_ENABLED', 'MUSIC_SCHEMA_ENABLED', 'MUSIC_LIBRARY_ENABLED', 'MUSIC_GENERATION_ENABLED']) {
        assert.equal(Object.hasOwn(config.vars, name), false, `${name} must stay consolidated`);
    }
});
