// Turns one GET /api/v1/social/analytics response into what the dashboard
// shows. Pure, so the arithmetic is tested without a browser.

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD (UTC) for the last `days` days, ending today. */
export function rangeForDays(days, now = new Date()) {
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
    return { from, to };
}

/** The immediately preceding inclusive period with the same number of days. */
export function previousRange({ from, to }) {
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
    const span = toMs - fromMs + DAY_MS;
    const previousTo = fromMs - DAY_MS;
    return {
        from: new Date(previousTo - span + DAY_MS).toISOString().slice(0, 10),
        to: new Date(previousTo).toISOString().slice(0, 10),
    };
}

/** A provider-honest change: null whenever either period lacks the metric. */
export function metricChange(current, previous) {
    return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

function count(value) {
    return Number.isFinite(value) ? value : 0;
}

export function postInteractions(post) {
    const m = (post && post.metrics) || {};
    return count(m.likes) + count(m.comments) + count(m.saves) + count(m.shares);
}

/** Sum of the per-post view counts a network reported; posts without one add nothing. */
export function totalViews(posts) {
    return (posts || []).reduce((sum, p) => sum + count(p && p.metrics && p.metrics.views), 0);
}

/** Sum a named post metric while preserving whether the provider supplied it. */
export function totalPostMetric(posts, key) {
    let supported = false;
    const value = (posts || []).reduce((sum, post) => {
        const metric = post && post.metrics && post.metrics[key];
        if (!Number.isFinite(metric)) return sum;
        supported = true;
        return sum + metric;
    }, 0);
    return supported ? value : null;
}

/**
 * @param {{evolution?: {date: string, metrics: Record<string, number>}[],
 *   posts?: {metrics: Record<string, number>}[]}} data
 * @returns {{followers: number|null, followersChange: number|null, posts: number, interactions: number,
 *   interactionsPerPost: number|null, engagementPer1000: number|null, hasInsights: boolean, hasViews: boolean, hasImpressions: boolean,
 *   series: {date: string, followers: number}[]}}
 */
export function summarize(data) {
    const days = (data && data.evolution) || [];
    const posts = (data && data.posts) || [];
    const series = days
        .filter((d) => Number.isFinite(d.metrics && d.metrics.followers))
        .map((d) => ({ date: d.date, followers: d.metrics.followers }));

    const followers = series.length ? series[series.length - 1].followers : null;
    // A change needs two different days to compare.
    const followersChange = series.length > 1 ? followers - series[0].followers : null;
    const interactions = posts.reduce((sum, p) => sum + postInteractions(p), 0);
    const interactionsPerPost = posts.length ? interactions / posts.length : null;
    // Average interactions per post, per 1000 followers: the measure
    // Metricool uses when reach is not available.
    const engagementPer1000 = interactionsPerPost !== null && followers
        ? (interactionsPerPost / followers) * 1000 : null;

    // Reach only exists for accounts that granted the insights permission.
    const hasInsights = posts.some((p) => Number.isFinite(p.metrics && p.metrics.reach));

    const hasViews = posts.some((p) => Number.isFinite(p.metrics && p.metrics.views));
    const hasImpressions = posts.some((p) => Number.isFinite(p.metrics && p.metrics.impressions));

    return { followers, followersChange, posts: posts.length, interactions, interactionsPerPost, engagementPer1000, hasInsights, hasViews, hasImpressions, series };
}

/**
 * Aggregate account summaries without manufacturing metrics a provider did not
 * return. A total is null when none of the included accounts supplied it.
 */
export function summarizePortfolio(entries) {
    const rows = (entries || []).map(({ account, data }) => {
        const summary = summarize(data);
        return {
            account,
            summary,
            views: totalPostMetric(data && data.posts, 'views'),
            impressions: totalPostMetric(data && data.posts, 'impressions'),
            reach: totalPostMetric(data && data.posts, 'reach'),
            lastOkAt: data && data.sync && data.sync.last_ok_at,
            failing: Boolean(data && data.sync && data.sync.failing),
        };
    });
    const sumNullable = (key) => {
        const values = rows.map((row) => row[key]).filter(Number.isFinite);
        return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const followers = rows.map((row) => row.summary.followers).filter(Number.isFinite);
    return {
        accounts: rows.length,
        followers: followers.length ? followers.reduce((sum, value) => sum + value, 0) : null,
        posts: rows.reduce((sum, row) => sum + row.summary.posts, 0),
        interactions: rows.reduce((sum, row) => sum + row.summary.interactions, 0),
        views: sumNullable('views'),
        impressions: sumNullable('impressions'),
        reach: sumNullable('reach'),
        staleAccounts: rows.filter((row) => row.failing || !row.lastOkAt).length,
        rows,
    };
}

function csvCell(value) {
    let text = value == null ? '' : String(value);
    // Provider names and captions are untrusted. Keep spreadsheet programs
    // from interpreting an exported cell as a formula.
    if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A spreadsheet-safe, provider-honest export for the currently visible table. */
export function analyticsCsv(rows) {
    const header = ['network', 'account', 'followers', 'posts', 'interactions', 'reach', 'impressions', 'views', 'last_updated', 'status'];
    return [header, ...(rows || []).map((row) => [
        row.account && row.account.network,
        row.account && (row.account.display_name || row.account.external_account_id),
        row.summary && row.summary.followers,
        row.summary && row.summary.posts,
        row.summary && row.summary.interactions,
        row.reach,
        row.impressions,
        row.views,
        row.lastOkAt,
        row.failing ? 'update_failed' : row.lastOkAt ? 'current' : 'awaiting_first_sync',
    ])].map((line) => line.map(csvCell).join(',')).join('\r\n');
}

/** Per-content export for one account. */
export function postAnalyticsCsv(account, posts) {
    const header = ['network', 'account', 'published_at', 'type', 'caption', 'permalink', 'reach', 'impressions', 'views', 'likes', 'comments', 'saves', 'shares', 'interactions'];
    return [header, ...(posts || []).map((post) => {
        const metrics = post.metrics || {};
        return [
            account && account.network,
            account && (account.display_name || account.external_account_id),
            post.published_at,
            post.type,
            post.caption,
            post.permalink,
            Number.isFinite(metrics.reach) ? metrics.reach : null,
            Number.isFinite(metrics.impressions) ? metrics.impressions : null,
            Number.isFinite(metrics.views) ? metrics.views : null,
            Number.isFinite(metrics.likes) ? metrics.likes : null,
            Number.isFinite(metrics.comments) ? metrics.comments : null,
            Number.isFinite(metrics.saves) ? metrics.saves : null,
            Number.isFinite(metrics.shares) ? metrics.shares : null,
            postInteractions(post),
        ];
    })].map((line) => line.map(csvCell).join(',')).join('\r\n');
}
