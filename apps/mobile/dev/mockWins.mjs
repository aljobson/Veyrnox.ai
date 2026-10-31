// Development screenshots only. Never imported by the app.
export function mockWins(method, enabled, now = Date.now()) {
    if (!enabled) return { status: 404, body: { error: 'not_found' } };
    if (method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
    const monday = new Date(now);
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const reached = (key, daysAgo, target = 1) => ({ key, reached_at: new Date(now - daysAgo * 86400000).toISOString(), progress: target, target });
    return { status: 200, body: {
        ok: true, week_start: monday.toISOString(),
        week: { creations: { total: 6, by_type: { image: 3, video: 2, audio: 1, other: 0 } },
            video_seconds: 35, credits_used: 38, posts: 3, views: { total: 1240, networks: ['instagram', 'youtube'] } },
        all: { creations: { total: 42, by_type: { image: 25, video: 10, audio: 6, other: 1 } },
            video_seconds: 125, credits_used: 420, posts: 12, views: { total: 18340, networks: ['instagram', 'youtube'] } },
        streak: { current: 4, best: 9, last7: [false, false, false, true, true, true, true] },
        milestones: [reached('first_image', 30), reached('first_video', 26), reached('creations_10', 20, 10),
            { key: 'creations_50', reached_at: null, progress: 42, target: 50 },
            reached('first_post', 22), reached('first_cinema_upload', 12), reached('streak_7', 10, 7)],
    } };
}
