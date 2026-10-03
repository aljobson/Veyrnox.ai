/**
 * The analytics sweep (ADR-0061 §2.5): each cron tick claims a few
 * connected accounts that are due, asks the network for the account's
 * totals and recent posts, and stores them (0188). An account comes round
 * every six hours — the claim itself pushes its next turn on, so a tick
 * that dies mid-fetch costs that account one round and nothing else.
 *
 * One account's failure is recorded on that account and never stops the
 * rest. Only networks with a fetcher below are claimed.
 */

import { rpc } from '../packages/db/supabase-client.js';
import { decryptToken } from './social/tokenCrypto.js';
import { fetchAnalytics as fetchInstagram, INSTAGRAM_INSIGHTS_SCOPE } from '../packages/adapters/social/instagram.js';

// An Instagram account with insights costs up to 13 network calls, and a
// cron tick shares one subrequest budget with every other sweep.
export const BATCH = 5;

const FETCHERS = {
    instagram: (accessToken, account) => fetchInstagram(accessToken, {
        insights: (account.scopes_granted || []).includes(INSTAGRAM_INSIGHTS_SCOPE),
    }),
};

/**
 * @param {{cfg: {supabaseUrl:string, serviceRoleKey:string}, cryptoCfg: {raw: Uint8Array}|null,
 *   fetchers?: Record<string, (accessToken: string, account: object) => Promise<{metrics: object, posts: object[]}>>,
 *   now?: Date}} deps
 * @returns {Promise<{ok:boolean, skipped?:string, error?:string, claimed?:number, synced?:number, failed?:number, errors?:number}>}
 */
export async function runAnalyticsSweep({ cfg, cryptoCfg, fetchers = FETCHERS, now = new Date() }) {
    if (!cfg?.supabaseUrl || !cfg.serviceRoleKey || !cryptoCfg) {
        return { ok: false, skipped: 'not_configured' };
    }

    let accounts;
    try {
        const claimed = await rpc('claim_social_analytics_accounts', {
            p_limit: BATCH, p_networks: Object.keys(fetchers),
        }, cfg);
        accounts = Array.isArray(claimed) ? claimed : [];
    } catch (err) {
        console.error('[analytics-sweep] claim failed:', err && err.message);
        return { ok: false, error: 'claim_failed' };
    }

    const metricDate = now.toISOString().slice(0, 10);
    const out = { claimed: accounts.length, synced: 0, failed: 0, errors: 0 };
    for (const account of accounts) {
        try {
            let result;
            try {
                const accessToken = await decryptToken(account.access_token_enc, cryptoCfg);
                result = await fetchers[account.network](accessToken, account);
            } catch (err) {
                out.failed += 1;
                console.error('[analytics-sweep] fetch failed for account', account.account_id, err && err.message);
                await rpc('record_social_analytics_failure', {
                    p_account_id: account.account_id, p_error: (err && err.message) || 'fetch_failed',
                }, cfg);
                continue;
            }
            const recorded = await rpc('record_social_analytics', {
                p_account_id: account.account_id, p_metric_date: metricDate,
                p_metrics: result.metrics || {}, p_posts: result.posts || [],
            }, cfg);
            // ACCOUNT_NOT_FOUND here means it was disconnected mid-fetch.
            if (recorded && recorded.ok === true) out.synced += 1; else out.failed += 1;
        } catch (err) {
            out.errors += 1;
            console.error('[analytics-sweep] report failed for account', account.account_id, err && err.message);
        }
    }
    return { ok: true, ...out };
}
