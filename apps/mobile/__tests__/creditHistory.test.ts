import type { ApiClient } from '../src/lib/api';
import { creditsDelta, entryDate, fetchHistoryPage, fetchUsage, freeNote, kindLabel, mergePages, usageLines } from '../src/lib/creditHistory';

const ID = '0b5c1f0e-6a52-4f54-9d1c-3a0e5a2b9c11';
const apiWith = (result: unknown) => {
    const request = jest.fn(async () => result);
    return { api: { request } as unknown as ApiClient, request };
};

describe('wording', () => {
    test('every server kind has plain wording and an unknown one reads as an adjustment', () => {
        for (const kind of ['checkin_reward', 'signup_grant', 'free_credit_expiry', 'generation_refund', 'generation', 'top_up', 'referral_reward', 'referral_reward_reversed', 'payment_adjustment', 'adjustment']) {
            expect(kindLabel(kind)).not.toBe('');
            expect(kindLabel(kind)).not.toContain('_');
        }
        expect(kindLabel('checkin_reward')).toBe('Daily check-in reward');
        expect(kindLabel('debit:secret-operator-text')).toBe('Adjustment');
    });

    test('credits in and out, singular and plural, never currency', () => {
        expect(creditsDelta(10)).toBe('+10 credits');
        expect(creditsDelta(-3)).toBe('−3 credits');
        expect(creditsDelta(1)).toBe('+1 credit');
        expect(creditsDelta(-1200)).toBe('−1,200 credits');
        expect(creditsDelta(10)).not.toMatch(/[$£€]/);
    });

    test('a bad date is blank, not "Invalid Date"', () => {
        expect(entryDate('nope')).toBe('');
        expect(entryDate('2026-10-18T09:30:00.000Z')).toMatch(/2026/);
    });

    test('notes the free part only when there is one', () => {
        const base = { id: ID, delta: -5, freeDelta: 0, kind: 'generation', createdAt: '2026-10-18T09:30:00Z' };
        expect(freeNote(base)).toBeNull();
        expect(freeNote({ ...base, freeDelta: -2 })).toBe('2 credits of this was free credits');
    });
});

describe('fetchHistoryPage', () => {
    test('maps rows, drops malformed ones, keeps a valid cursor', async () => {
        const { api, request } = apiWith({
            entries: [
                { id: ID, delta: -5, free_delta: -5, kind: 'generation', created_at: '2026-10-18T09:30:00Z', job_id: 'x' },
                { id: 'no-date', delta: 1 },
                null,
                { id: 'b', delta: 'x', created_at: '2026-10-18T09:30:00Z' },
            ],
            next: { before: '2026-10-18T09:30:00.123456Z', before_id: ID },
        });
        const page = await fetchHistoryPage(api);
        expect(page.entries).toEqual([{ id: ID, delta: -5, freeDelta: -5, kind: 'generation', createdAt: '2026-10-18T09:30:00Z' }]);
        expect(page.next).toEqual({ before: '2026-10-18T09:30:00.123456Z', beforeId: ID });
        expect(request).toHaveBeenCalledWith('/api/v1/ledger');
    });

    test('sends the cursor encoded, and treats a bad cursor or body as the end', async () => {
        const { api, request } = apiWith({ entries: [], next: { before: 'x', before_id: 'not-a-uuid' } });
        const page = await fetchHistoryPage(api, { before: '2026-10-18T09:30:00+00:00', beforeId: ID });
        expect(request).toHaveBeenCalledWith(`/api/v1/ledger?before=2026-10-18T09%3A30%3A00%2B00%3A00&before_id=${ID}`);
        expect(page).toEqual({ entries: [], next: null });
        expect(await fetchHistoryPage(apiWith({}).api)).toEqual({ entries: [], next: null });
    });
});

describe('usage', () => {
    test('reads the three windows and says "at least" when the month is a floor', async () => {
        const usage = await fetchUsage(apiWith({ spent: { day: 3, week: 10, month: 40 }, truncated: true }).api);
        expect(usageLines(usage)).toEqual(['Last 24 hours: 3 credits', 'Last 7 days: 10 credits', 'Last 30 days: at least 40 credits']);
    });

    test('junk becomes zero', async () => {
        expect(await fetchUsage(apiWith({ spent: { day: -2, week: 'x' } }).api)).toEqual({ day: 0, week: 0, month: 0, truncated: false });
    });
});

test('mergePages ignores a repeated row', () => {
    const e = (id: string) => ({ id, delta: 1, freeDelta: 0, kind: 'top_up', createdAt: '2026-10-18T09:30:00Z' });
    expect(mergePages([e('a'), e('b')], [e('b'), e('c')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
});

describe('names on creation rows', () => {
    const JOB = '7a9f0c2e-1b34-4c56-8d78-9e0f1a2b3c4d';
    const row = (kind: string, jobId?: string) => ({ id: ID, delta: -5, freeDelta: 0, kind, createdAt: '2026-10-18T09:30:00Z', ...(jobId ? { jobId } : {}) });
    const { entryTitle, resolveJobNames } = require('../src/lib/creditHistory');

    test('a creation row reads as the model, a refund says refund and names it, anything else keeps its wording', () => {
        const names = new Map([[JOB, 'Veo 3.1 Lite']]);
        expect(entryTitle(row('generation', JOB), names)).toBe('Veo 3.1 Lite');
        expect(entryTitle(row('generation_refund', JOB), names)).toBe('Refund: Veo 3.1 Lite');
        expect(entryTitle(row('generation', JOB), new Map())).toBe('Creation');
        expect(entryTitle(row('top_up'), names)).toBe('Credits bought');
    });

    test('the ledger job id is read, and a malformed one is dropped', async () => {
        const { api } = apiWith({ entries: [{ id: ID, delta: -5, created_at: 'x', kind: 'generation', job_id: JOB }, { id: ID, delta: -5, created_at: 'x', kind: 'generation', job_id: 'nope' }], next: null });
        const page = await fetchHistoryPage(api);
        expect(page.entries[0].jobId).toBe(JOB);
        expect(page.entries[1].jobId).toBeUndefined();
    });

    test('names come from the jobs list by model, falling back to the job label, over as few pages as needed', async () => {
        const OTHER = '11111111-2222-4333-8444-555555555555';
        const request = jest.fn()
            .mockResolvedValueOnce({ jobs: [{ job_id: OTHER, model_id: 'x' }], next: { before: 't', before_id: 'i' } })
            .mockResolvedValueOnce({ jobs: [{ job_id: JOB, model_id: 'veo', label: 'Lite' }], next: { before: 't2', before_id: 'i2' } });
        const names = await resolveJobNames({ request } as unknown as ApiClient, [row('generation', JOB)], new Map(), new Map([['veo', 'Veo 3.1 Lite']]));
        expect(names.get(JOB)).toBe('Veo 3.1 Lite');
        expect(request).toHaveBeenCalledTimes(2);
    });
});
