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
import { decryptToken, encryptToken } from './social/tokenCrypto.js';
import { fetchAnalytics as fetchInstagram, INSTAGRAM_INSIGHTS_SCOPE } from '../packages/adapters/social/instagram.js';
import { fetchAnalytics as fetchYoutube, youtubeConfig, refreshAccessToken as refreshYoutubeToken } from '../packages/adapters/social/youtube.js';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// An Instagram account with insights costs up to 13 network calls, and a
// cron tick shares one subrequest budget with every other sweep.
export const BATCH = 5;

const FETCHERS = {
    youtube: (accessToken, account) => fetchYoutube(accessToken, { externalAccountId: account.external_account_id }),
    instagram: (accessToken, account) => fetchInstagram(accessToken, {
        insights: (account.scopes_granted || []).includes(INSTAGRAM_INSIGHTS_SCOPE),
    }),
};

/**
 * @param {{cfg: {supabaseUrl:string, serviceRoleKey:string}, cryptoCfg: {raw: Uint8Array}|null,
 *   fetchers?: Record<string, (accessToken: string, account: object) => Promise<{metrics: object, posts: object[]}>>,
 *   now?: Date, youtubeCfg?: {clientId:string, clientSecret:string}|null,
 *   refreshYoutube?: (cfg: object, refreshToken: string) => Promise<{accessToken:string, expiresAt:string}>}} deps
 * @returns {Promise<{ok:boolean, skipped?:string, error?:string, claimed?:number, synced?:number, failed?:number, errors?:number}>}
 */
export async function runAnalyticsSweep({ cfg, cryptoCfg, fetchers = FETCHERS, now = new Date(), youtubeCfg = youtubeConfig(), refreshYoutube = refreshYoutubeToken }) {
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
                let accessToken = await decryptToken(account.access_token_enc, cryptoCfg);
                if (account.network === 'youtube' && (!account.token_expires_at ||
                    !Number.isFinite(Date.parse(account.token_expires_at)) ||
                    Date.parse(account.token_expires_at) - now.getTime() < TOKEN_REFRESH_BUFFER_MS)) {
                    if (!account.refresh_token_enc || !youtubeCfg) throw new Error('youtube_token_refresh_unavailable');
                    const refreshToken = await decryptToken(account.refresh_token_enc, cryptoCfg);
                    let refreshed;
                    try { refreshed = await refreshYoutube(youtubeCfg, refreshToken); }
                    catch { throw new Error('youtube_token_refresh_failed'); }
                    const updated = await rpc('update_social_account_token', {
                        p_account_id: account.account_id,
                        p_access_token_enc: await encryptToken(refreshed.accessToken, cryptoCfg),
                        p_token_expires_at: refreshed.expiresAt,
                    }, cfg);
                    if (updated?.ok !== true) throw new Error('youtube_token_update_failed');
                    accessToken = refreshed.accessToken;
                }
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
