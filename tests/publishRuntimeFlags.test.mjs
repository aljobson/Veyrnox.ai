import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishRuntimeFeatureEnabled } from '../lib/social/runtimeFlags.js';
import { freeSocialAccountLimit, socialAccountLimitForTier, socialConnectionWriter } from '../lib/social/accountAllowance.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

const grouped = (plans = 'false', videoDestinations = 'false', inbox = 'false', smartlinks = 'false', contentPresets = 'false', queues = 'false', approvals = 'false', teams = 'false', variants = 'false', reports = 'false', customerApi = 'false', customerWebhooks = 'false', scheduledReports = 'false', inboxWorkflows = 'false', ads = 'false', commerce = 'false', rssAutolists = 'false', reportExports = 'false', reportDelivery = 'false', multiAccount = 'false') => ({
    PUBLISH_RUNTIME_FLAGS: JSON.stringify({ plans, videoDestinations, inbox, smartlinks, contentPresets, queues, approvals, teams, variants, reports, customerApi, customerWebhooks, scheduledReports, inboxWorkflows, ads, commerce, rssAutolists, reportExports, reportDelivery, multiAccount }),
});

test('grouped Publish controls resolve independently and retain legacy rollback overrides', () => {
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', grouped('true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', grouped('false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_INBOX_ENABLED', grouped('false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_SMARTLINKS_ENABLED', grouped('false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CONTENT_PRESETS_ENABLED', grouped('false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_QUEUES_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_APPROVALS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_TEAMS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CONTENT_VARIANTS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORTS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CUSTOMER_API_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CUSTOMER_WEBHOOKS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_SCHEDULED_REPORTS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_INBOX_WORKFLOWS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_ADS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_COMMERCE_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_RSS_AUTOLISTS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORT_EXPORTS_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORT_DELIVERY_ENABLED', grouped('false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true')), true);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', { ...grouped('true'), PUBLISH_PLANS_ENABLED: 'false' }), false);
    assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', { PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'true' }), true);
});

test('malformed, incomplete and unknown grouped Publish controls fail closed', () => {
    for (const value of [undefined, 'broken', 'null', '[]', 'true', '{}', '{"plans":true}', '{"other":"true"}', ' '.repeat(1025)]) {
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_INBOX_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_SMARTLINKS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CONTENT_PRESETS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_QUEUES_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_APPROVALS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_TEAMS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CONTENT_VARIANTS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORTS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CUSTOMER_API_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_CUSTOMER_WEBHOOKS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_SCHEDULED_REPORTS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_INBOX_WORKFLOWS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_ADS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_COMMERCE_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_RSS_AUTOLISTS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORT_EXPORTS_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_REPORT_DELIVERY_ENABLED', { PUBLISH_RUNTIME_FLAGS: value }), false);
    }
    assert.equal(publishRuntimeFeatureEnabled('UNKNOWN', grouped('true', 'true')), false);
});

test('production and staging expose the paid Publish suite while native video stays closed', () => {
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    const advanced = ['PUBLISH_INBOX_ENABLED', 'PUBLISH_SMARTLINKS_ENABLED', 'PUBLISH_CONTENT_PRESETS_ENABLED',
        'PUBLISH_QUEUES_ENABLED', 'PUBLISH_APPROVALS_ENABLED', 'PUBLISH_TEAMS_ENABLED',
        'PUBLISH_CONTENT_VARIANTS_ENABLED', 'PUBLISH_REPORTS_ENABLED', 'PUBLISH_CUSTOMER_API_ENABLED',
        'PUBLISH_CUSTOMER_WEBHOOKS_ENABLED', 'PUBLISH_SCHEDULED_REPORTS_ENABLED',
        'PUBLISH_INBOX_WORKFLOWS_ENABLED', 'PUBLISH_ADS_ENABLED', 'PUBLISH_COMMERCE_ENABLED',
        'PUBLISH_RSS_AUTOLISTS_ENABLED', 'PUBLISH_REPORT_EXPORTS_ENABLED', 'PUBLISH_REPORT_DELIVERY_ENABLED'];
    for (const vars of [config.vars, config.env.staging.vars]) {
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_PLANS_ENABLED', vars), true);
        assert.equal(publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', vars), false);
        assert.equal(freeSocialAccountLimit(vars), 1);
        assert.equal(socialAccountLimitForTier('free', vars), 1);
        assert.equal(socialAccountLimitForTier('publish', vars), 5);
        assert.equal(socialConnectionWriter(vars), 'record_social_multi_account_connection');
        assert.equal(Object.hasOwn(vars, 'PUBLISH_MULTI_ACCOUNT_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_PLANS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_VIDEO_DESTINATIONS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_INBOX_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_SMARTLINKS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_CONTENT_PRESETS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_QUEUES_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_APPROVALS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_TEAMS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_CONTENT_VARIANTS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_REPORTS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_CUSTOMER_API_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_CUSTOMER_WEBHOOKS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_SCHEDULED_REPORTS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_RSS_AUTOLISTS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_REPORT_EXPORTS_ENABLED'), false);
        assert.equal(Object.hasOwn(vars, 'PUBLISH_REPORT_DELIVERY_ENABLED'), false);
    }
    for (const name of advanced) {
        assert.equal(publishRuntimeFeatureEnabled(name, config.vars), true);
        assert.equal(publishRuntimeFeatureEnabled(name, config.env.staging.vars), true);
    }
    assert.equal(config.env.staging.vars.REPORT_EMAIL_FROM, 'Veyrnox Reports <support@veyrnox.ai>');
    assert.equal(config.env.staging.vars.REPORT_EMAIL_REPLY_TO, 'support@veyrnox.ai');
});
