import { canRetry, canStart, createDraftQueue, decideDraft, owns, retryDelay, type Locks, type Operation } from '../src/lib/editorSaveSafety';
const document = { schema_version: 1 as const, project_id: 'p', brief: 'head' };
const head = { document, revision: 4 };
const draft = { owner: 'owner', projectId: 'p', baseRevision: 4, document: { ...document, brief: 'local' }, updatedAt: 1 };

test('decideDraft none, identical, recover and conflict', () => {
    expect(decideDraft(null, head)).toBe('none');
    expect(decideDraft({ ...draft, document }, head)).toBe('none');
    expect(decideDraft(draft, head)).toBe('recover');
    expect(decideDraft({ ...draft, baseRevision: 3 }, head)).toBe('conflict');
});
test('retry delays 5,10,20,40,60,60 and 429 retryAfterSeconds capped at 600', () => {
    expect([0, 1, 2, 3, 4, 5].map(n => retryDelay(n))).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    expect(retryDelay(0, 73)).toBe(73000); expect(retryDelay(0, 900)).toBe(600000);
});
test('a write queued before a replacement is skipped and the removal runs last', async () => {
    let release!: () => void, epoch = 0;
    const work = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const queue = createDraftQueue({ write: async (value: string) => { calls.push(value); await work; return true; }, remove: async () => { calls.push('remove'); } });
    const first = queue.write('inflight', () => true); await Promise.resolve();
    const stale = queue.write('stale', () => epoch === 0);
    epoch++; const removal = queue.remove(() => epoch === 1);
    expect(calls).toEqual(['inflight']); release(); await Promise.all([first, stale, removal]);
    expect(calls).toEqual(['inflight', 'remove']);
});
test('storage failure does not poison the draft queue', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const queue = createDraftQueue({ write: async () => { throw Error('full'); }, remove });
    await expect(queue.write(null, () => true)).rejects.toThrow('full');
    await queue.remove(() => true); expect(remove).toHaveBeenCalledTimes(1);
});
test('canStart, owns and canRetry: own lock passes owns, another lock fails both, a retained ambiguous op passes canRetry only', () => {
    const op: Operation = { token: {}, epoch: 2, state: 'ambiguous' };
    const free: Locks = { live: true, epoch: 2, imports: 0, saving: null, replacing: null, pending: null, restore: null };
    expect(canStart(free)).toBe(true);
    const own = { ...free, saving: op, pending: op };
    expect(canStart(own)).toBe(false); expect(owns(own, op)).toBe(true); expect(canRetry(own, op)).toBe(true);
    const other = { ...own, saving: { ...op, token: {} } };
    expect(owns(other, op)).toBe(false); expect(canRetry(other, op)).toBe(false);
    expect(canRetry({ ...free, pending: op }, op)).toBe(true); expect(canStart({ ...free, pending: op })).toBe(false);
    expect(owns({ ...own, epoch: 3 }, op)).toBe(false); expect(canRetry({ ...own, live: false }, op)).toBe(false);
});
