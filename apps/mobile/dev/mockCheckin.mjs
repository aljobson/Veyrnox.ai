const rewards = [1, 1, 2, 2, 2, 3];
// Per-viewer state, while retaining the mock server's shared development balance.
const streaks = new Map();
export function mockCheckin(method, viewer, state, enabled, now = Date.now()) {
    if (!enabled) return { status: 404, body: { error: 'not_found' } };
    if (!['GET', 'POST'].includes(method)) return { status: 405, body: { error: 'method_not_allowed' } };
    const today = new Date(now).toISOString().slice(0, 10);
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const old = streaks.get(viewer);
    const claimed = old?.date === today;
    const streak = old && [today, yesterday].includes(old.date) ? old.streak : 0;
    const next = Math.min(streak + 1, 6);
    if (method === 'GET') return { status: 200, body: { ok: true, claimed_today: claimed, streak, next_day: next, next_credits: rewards[next - 1], rewards } };
    const n = claimed ? streak : streak + 1;
    const day = Math.min(n, 6);
    const credits = claimed ? 0 : rewards[day - 1];
    state.balance += credits;
    streaks.set(viewer, { date: today, streak: n });
    return { status: 200, body: { ok: true, already_claimed: claimed, streak: n, day, credits, balance_after: state.balance } };
}
