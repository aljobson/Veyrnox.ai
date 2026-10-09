// Turns one GET /api/v1/social/analytics response into what the dashboard
// shows. Pure, so the arithmetic is tested without a browser.

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD (UTC) for the last `days` days, ending today. */
export function rangeForDays(days, now = new Date()) {
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
    return { from, to };
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

/**
 * @param {{evolution?: {date: string, metrics: Record<string, number>}[],
 *   posts?: {metrics: Record<string, number>}[]}} data
 * @returns {{followers: number|null, followersChange: number|null, posts: number, interactions: number,
 *   interactionsPerPost: number|null, engagementPer1000: number|null, hasInsights: boolean, hasViews: boolean,
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

    return { followers, followersChange, posts: posts.length, interactions, interactionsPerPost, engagementPer1000, hasInsights, hasViews, series };
}
