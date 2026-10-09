// Stored lifetime counters describe past performance; they do not predict
// audience activity or establish that posting more often causes engagement.
export const MIN_SLOT_POSTS = 3;
export const MIN_MEASURED_POSTS = 10;
export const MIN_HISTORY_DAYS = 14;
const finite = (value) => Number.isFinite(value) && value >= 0;

export function summarizePostingInsights(insights) {
    const cells = (insights?.heatmap || []).filter((c) => Number.isInteger(c.day) && c.day >= 1 && c.day <= 7
        && Number.isInteger(c.hour) && c.hour >= 0 && c.hour <= 23 && Number.isInteger(c.posts) && c.posts >= 0);
    const candidates = cells.filter((c) => c.posts >= MIN_SLOT_POSTS && finite(c.score));
    const enoughHistory = insights?.measured_posts >= MIN_MEASURED_POSTS && insights?.history_days >= MIN_HISTORY_DAYS;
    const ranked = enoughHistory ? [...candidates].filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score || b.posts - a.posts || a.day - b.day || a.hour - b.hour) : [];
    const groups = new Map();
    for (const week of insights?.frequency || []) {
        if (!Number.isInteger(week.posts) || week.posts < 0 || !Number.isInteger(week.measured_posts)
            || week.measured_posts < 0 || week.measured_posts > week.posts) continue;
        const group = groups.get(week.posts) || { postsPerWeek: week.posts, weeks: 0, measuredPosts: 0, interactions: 0 };
        group.weeks++;
        if (week.measured_posts > 0 && finite(week.avg_interactions)) {
            group.measuredPosts += week.measured_posts;
            group.interactions += week.avg_interactions * week.measured_posts;
        }
        groups.set(week.posts, group);
    }
    const frequency = [...groups.values()].sort((a, b) => a.postsPerWeek - b.postsPerWeek)
        .map(({ interactions, ...group }) => ({ ...group, score: group.measuredPosts ? interactions / group.measuredPosts : null }));
    return { cells, enoughHistory, topSlots: ranked.slice(0, 3), maxScore: ranked[0]?.score || 0, frequency };
}
