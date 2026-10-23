import { parseAccounts, parsePosts } from '../src/lib/publish';
import { canConnectAccounts, canManageBrand, canPublish, canReview, hasPublishPlan, publishDestinations, publishSummary } from '../src/lib/publishDashboard';

const state = (overrides: Record<string, unknown> = {}) => parseAccounts({
    brandRole: 'owner', planTier: 'publish', plansEnabled: true,
    inboxEnabled: true, inboxWorkflowsEnabled: true, smartlinksEnabled: true, queuesEnabled: true,
    approvalsEnabled: true, teamsEnabled: true, reportsEnabled: true, adsEnabled: true,
    commerceEnabled: true, rssAutolistsEnabled: true, customerApiEnabled: true,
    accounts: [{ id: 'a1', network: 'instagram', status: 'active' }, { id: 'a2', network: 'youtube', status: 'expired' }],
    ...overrides,
});

describe('Publish dashboard visibility', () => {
    test('a paid owner sees enabled advanced tools', () => {
        const visible = publishDestinations(state());
        expect(visible).toEqual(expect.arrayContaining(['calendar', 'approvals', 'inbox', 'workflows', 'autolists', 'reports', 'team', 'activity', 'developer']));
    });

    test('free plans and limited roles hide actions they cannot use', () => {
        const visible = publishDestinations(state({ brandRole: 'viewer', planTier: 'free' }));
        expect(visible).toEqual(expect.arrayContaining(['accounts', 'posts', 'analytics', 'brands', 'inbox', 'contacts', 'smartlink']));
        expect(visible).not.toEqual(expect.arrayContaining(['calendar', 'approvals', 'workflows', 'queues', 'reports', 'team', 'developer']));
    });

    test('role helpers match the website permissions', () => {
        expect(canPublish('editor')).toBe(true);
        expect(canPublish('reviewer')).toBe(false);
        expect(canReview('reviewer')).toBe(true);
        expect(canReview('editor')).toBe(false);
        expect(canManageBrand('manager')).toBe(true);
        expect(canManageBrand('editor')).toBe(false);
    });

    test('plans-disabled installations count as fully enabled', () => {
        expect(hasPublishPlan(state({ planTier: 'free', plansEnabled: false }))).toBe(true);
    });

    test('connecting is offered only for an own-brand owner below the account limit', () => {
        expect(canConnectAccounts(state({ accounts: [] }), null)).toBe(true);
        expect(canConnectAccounts(state({ accounts: [], brandRole: 'editor' }), null)).toBe(false);
        expect(canConnectAccounts(state({ accounts: [] }), '22222222-2222-4222-8222-222222222222')).toBe(false);
        expect(canConnectAccounts(state({ accountLimit: 1, accounts: [{ id: 'a1', network: 'instagram', status: 'expired' }] }), null)).toBe(false);
    });
});

describe('Publish dashboard summary', () => {
    test('counts live state and chooses the next future scheduled post', () => {
        const posts = parsePosts({ posts: [
            { id: 'old', status: 'scheduled', scheduled_at: '2026-10-20T10:00:00Z' },
            { id: 'next', status: 'scheduled', scheduled_at: '2026-10-25T10:00:00Z' },
            { id: 'later', status: 'scheduled', scheduled_at: '2026-10-26T10:00:00Z' },
            { id: 'bad', status: 'failed', targets: [] },
        ] });
        expect(publishSummary(state(), posts, new Date('2026-10-23T10:00:00Z'))).toMatchObject({ connected: 1, attention: 1, scheduled: 3, failed: 1, nextScheduled: { id: 'next' } });
    });
});
