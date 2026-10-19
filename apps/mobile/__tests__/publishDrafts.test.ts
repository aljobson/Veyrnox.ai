import { ApiError, type ApiClient } from '../src/lib/api';
import { batchGroups, draftsErrorKey, fetchDrafts, parseDrafts } from '../src/lib/publishDrafts';

const B1 = '44444444-4444-4444-8444-444444444444';
const B2 = '55555555-5555-4555-8555-555555555555';
const draft = (o: Record<string, unknown> = {}) => ({
    id: 'd1', draft_batch_id: B1, scheduled_at: '2026-10-22T09:00:00Z', global_text: 'Spring drop', created_at: '2026-10-18T10:00:00Z',
    media: [{ media_type: 'video', job_id: 'j1' }], networks: ['linkedin', 'tiktok'], ...o,
});

describe('parseDrafts', () => {
    test('keeps text, time, batch, networks and media types; never the job ids', () => {
        const { drafts } = parseDrafts({ brand_id: 'b', drafts: [draft()], approvalEnabled: true });
        expect(drafts[0]).toMatchObject({ id: 'd1', batchId: B1, text: 'Spring drop', scheduledAt: '2026-10-22T09:00:00Z', networks: ['linkedin', 'tiktok'], mediaTypes: ['video'] });
        expect(JSON.stringify(drafts[0])).not.toContain('j1');
    });
    test('skips rows without an id, tolerates odd media and networks, bounds long text', () => {
        const { drafts } = parseDrafts({ drafts: [{ draft_batch_id: B1 }, draft({ id: 'd2', media: 'x', networks: [1, 'twitter', null] }), draft({ id: 'd3', global_text: 'y'.repeat(5000) }), 9] });
        expect(drafts.map((d) => d.id)).toEqual(['d2', 'd3']);
        expect(drafts[0]?.networks).toEqual(['twitter']);
        expect(drafts[0]?.mediaTypes).toEqual([]);
        expect((drafts[1]?.text ?? '').length).toBeLessThanOrEqual(600);
    });
    test.each([[null], [{}], [{ drafts: 'x' }]])('%p is empty', (b) => {
        expect(parseDrafts(b).drafts).toEqual([]);
    });
});

describe('batchGroups', () => {
    test('groups drafts by batch in first-seen order and counts them; no batch is its own group', () => {
        const { drafts } = parseDrafts({ drafts: [draft({ id: 'a', draft_batch_id: B1 }), draft({ id: 'b', draft_batch_id: B2 }), draft({ id: 'c', draft_batch_id: B1 }), draft({ id: 'e', draft_batch_id: null })] });
        const g = batchGroups(drafts);
        expect(g.map((x) => [x.batchId, x.drafts.map((d) => d.id)])).toEqual([[B1, ['a', 'c']], [B2, ['b']], [null, ['e']]]);
    });
});

describe('fetchDrafts and errors', () => {
    test('reads /api/v1/social/drafts', async () => {
        const request = jest.fn(async () => ({ drafts: [] }));
        await fetchDrafts({ request } as unknown as ApiClient);
        expect(request.mock.calls[0]).toEqual(['/api/v1/social/drafts']);
    });
    const k = (s: number, c: string) => draftsErrorKey(new ApiError(s, c, { error: c }));
    test('maps answers to plain keys', () => {
        expect(k(404, 'brand_not_found')).toBe('drafts.err.brand');
        expect(k(429, 'rate_limited')).toBe('drafts.err.rate');
        expect(k(0, 'network')).toBe('drafts.err.network');
        expect(k(503, 'supabase_not_configured')).toBe('drafts.err.later');
        expect(k(502, 'internal')).toBe('common.error');
        expect(draftsErrorKey(new Error('x'))).toBe('common.error');
    });
});
