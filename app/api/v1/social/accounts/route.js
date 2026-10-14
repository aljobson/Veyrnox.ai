/**
 * GET /api/v1/social/accounts — the caller's connected social accounts
 * (technical spec §2.3, ADR-0061). Auto-creates the caller's default
 * Publish brand on first touch (v1 has no multi-brand UI yet).
 *
 * Response (200): { brand_id, accounts: [{ id, network, external_account_id,
 *   display_name, avatar_url, status, connected_at, token_expires_at }] }
 *   Never includes access_token_enc/refresh_token_enc — the RPC itself
 *   doesn't select them (technical spec §2.7 "tokens never returned to the
 *   client").
 *
 * Identity comes from x-veyrnox-auth-id, which middleware.js sets after
 * verifying the Supabase JWT and overwrites on every request. A
 * client-supplied id can never reach this handler.
 */

import { publishPlansEnabled, socialApprovalsEnabled, socialContentPresetsEnabled, socialContentVariantsEnabled, socialCustomerApiEnabled, socialCustomerWebhooksEnabled, socialInboxEnabled, socialInboxWorkflowsEnabled, socialQueuesEnabled, socialReportsEnabled, socialSmartLinksEnabled, socialTeamsEnabled, youtubeVisibilityEnabled } from '../../../../../lib/social/publishFeature.js';
import { readPublishEntitlement } from '../../../../../lib/social/publishPlanApi.js';
import { socialUploadsEnabled } from '../../../../../lib/social/uploadPolicy.js';
import { networkEnabled, networkMedia } from '../../../../../lib/social/networks.js';
import { networkReadiness } from '../../../../../lib/social/networkReadiness.js';
import { tiktokReviewAllowed } from '../../../../../lib/social/tiktokReview.js';
import { resolveBrand } from '../../../../../lib/social/resolveBrand.js';
import { NextResponse } from 'next/server';
import { accountReadLimit } from '../../../../../lib/accountReadLimit.js';
import { rpc, envConfig, SupabaseError } from '../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) {
        return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
    }

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }

    const limited = await accountReadLimit(authId, cfg, { brand_id: null, accounts: [] });
    if (limited) return limited;

    const brand = await resolveBrand(authId, cfg, 'api/v1/social/accounts:GET', {
        request: req, allowedRoles: ['owner', 'manager', 'editor', 'reviewer', 'analyst', 'viewer'],
    });
    if (brand.error) return brand.error;

    let accounts;
    try {
        accounts = await rpc('list_social_accounts', { p_auth_id: brand.rpcAuthId, p_brand_id: brand.brandId }, cfg);
    } catch (err) {
        const status = err instanceof SupabaseError ? err.status : 0;
        console.error('[api/v1/social/accounts] account list failed:', status, err && err.body);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }
    if (!accounts || accounts.ok !== true) {
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let entitlement = null;
    if (publishPlansEnabled()) {
        try { entitlement = await readPublishEntitlement(brand.rpcAuthId, cfg); }
        catch (err) {
            console.error('[api/v1/social/accounts] entitlement lookup failed:', err instanceof SupabaseError ? err.status : 0);
            return NextResponse.json({ error: 'internal' }, { status: 502 });
        }
        if (!entitlement) return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    return NextResponse.json({
        brand_id: brand.brandId,
        brandRole: brand.role,
        accountLimit: entitlement?.account_limit || 1,
        ...(entitlement ? { planTier: entitlement.tier } : {}),
        accounts: (accounts.accounts || []).map((account) => ({ ...account, publishingEnabled: networkEnabled(account.network)
            || (account.network === 'tiktok' && tiktokReviewAllowed(authId)), supportedMedia: networkMedia(account.network) })),
        uploadsEnabled: socialUploadsEnabled(process.env, authId),
        youtubeVisibilityEnabled: youtubeVisibilityEnabled(),
        plansEnabled: publishPlansEnabled(),
        inboxEnabled: socialInboxEnabled(),
        inboxWorkflowsEnabled: socialInboxWorkflowsEnabled(),
        smartlinksEnabled: socialSmartLinksEnabled(),
        contentPresetsEnabled: socialContentPresetsEnabled(),
        queuesEnabled: socialQueuesEnabled(),
        approvalsEnabled: socialApprovalsEnabled(),
        teamsEnabled: socialTeamsEnabled(),
        variantsEnabled: socialContentVariantsEnabled(),
        reportsEnabled: socialReportsEnabled(),
        customerApiEnabled: socialCustomerApiEnabled(),
        customerWebhooksEnabled: socialCustomerWebhooksEnabled(),
        networks: networkReadiness(process.env, authId),
    }, { headers: { 'Cache-Control': 'no-store' } });
}
