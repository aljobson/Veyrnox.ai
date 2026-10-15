import { rpc } from '../../packages/db/supabase-client.js';
import { previousRange, rangeForDays, summarizePortfolio } from './analyticsSummary.js';

function normalize(result) {
    return { account: result.account, sync: result.sync || {}, evolution: result.evolution || [], posts: result.posts || [] };
}

/** Load the provider data represented by one saved report without inventing unsupported metrics. */
export async function loadSocialReportData({ template, authId, brandId, cfg, rpcCall = rpc, now = new Date() }) {
    const range = rangeForDays(template.range_days, now);
    const priorRange = template.compare_previous ? previousRange(range) : null;
    const listed = await rpcCall('list_social_accounts', { p_auth_id: authId, p_brand_id: brandId }, cfg);
    if (!listed?.ok) return { ok: false, error: 'accounts_unavailable' };
    let accounts = (listed.accounts || []).filter((item) => item.status === 'active');
    if (template.account_id) accounts = accounts.filter((item) => item.id === template.account_id);
    if (!accounts.length) return { ok: false, error: 'account_unavailable' };
    accounts = accounts.slice(0, 5);
    const loadRange = async (period) => {
        const entries = [];
        for (const account of accounts) {
            const result = await rpcCall('get_social_analytics', {
                p_auth_id: authId, p_account_id: account.id, p_from: period.from, p_to: period.to,
            }, cfg);
            if (result?.ok) entries.push({ account: result.account || account, data: normalize(result) });
        }
        return { entries, portfolio: summarizePortfolio(entries) };
    };
    const current = await loadRange(range);
    if (!current.entries.length) return { ok: false, error: 'analytics_unavailable' };
    const previous = priorRange ? await loadRange(priorRange) : null;
    return { ok: true, range, previousRange: priorRange, current, previous };
}
