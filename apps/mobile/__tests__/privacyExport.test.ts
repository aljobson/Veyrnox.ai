import { ApiError, type ApiClient } from '../src/lib/api';
import { exportErrorState, fetchPage, runExport, type ExportWriter } from '../src/lib/privacyExport';

const id = '11111111-1111-4111-8111-111111111111';
const metadata = () => ({ export_id: id, as_of: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), resumed: false,
    sections: ['profile', 'credit_history', 'chat_threads'] });
function writer() {
    const chunks: string[] = [];
    return { chunks, create: jest.fn(), append: jest.fn((text: string) => { chunks.push(text); }), delete: jest.fn(() => { chunks.length = 0; }) };
}
const api = (request: jest.Mock) => ({ request } as unknown as ApiClient);
function pages() {
    return jest.fn(async (path: string) => {
        if (!path.includes('?')) return metadata();
        const query = new URL('https://test' + path).searchParams, section = query.get('section');
        if (section === 'profile') return { rows: [{ email: 'mine@example.invalid' }], next: null };
        if (section === 'credit_history') return query.has('after') ? { rows: [{ delta: -2 }], next: null } : { rows: [{ delta: 4 }], next: { after: '2026-01-01T00:00:00Z', key: id } };
        if (section === 'chat_threads') return { rows: [{ id, title: 'My chat' }, { id: 'second', title: 'Another' }], next: null };
        if (section === 'chat_messages') return query.has('after') ? { rows: [{ seq: '9007199254740994', content: 'two' }], next: null } :
            { rows: [{ seq: '9007199254740993', content: 'one' }], next: { after: '9007199254740993', key: null } };
        throw new Error('unexpected section');
    });
}
test('streams valid JSON across pages and nests messages without rounding sequence cursors', async () => {
    const output = writer(), request = pages();
    await runExport(api(request), output, jest.fn(), new AbortController().signal);
    const json = JSON.parse(output.chunks.join(''));
    expect(json.format).toBe('veyrnox.ai-data-export'); expect(json.version).toBe(1);
    expect(json.sections.profile.email).toBe('mine@example.invalid');
    expect(json.sections.credit_history).toEqual([{ delta: 4 }, { delta: -2 }]);
    expect(json.sections.chat_threads).toHaveLength(2);
    expect(json.sections.chat_threads[0].messages.map((r: { content: string }) => r.content)).toEqual(['one', 'two']);
    expect(json.sections.chat_messages).toBeUndefined();
    expect(request.mock.calls.some(([path]) => path.includes('after=9007199254740993'))).toBe(true);
    expect(output.delete).not.toHaveBeenCalled();
});
test('fetchPage sends opaque string cursors unchanged, without key for messages', async () => {
    const request = jest.fn().mockResolvedValue({ rows: [], next: null });
    await fetchPage(api(request), id, 'chat_messages', { after: '9007199254740993', key: null }, id);
    expect(request.mock.calls[0][0]).toContain('after=9007199254740993');
    expect(request.mock.calls[0][0]).not.toContain('key=');
});
test('failure after written pages deletes the partial file', async () => {
    const output = writer(), base = pages();
    const request = jest.fn(async (path: string) => { if (path.includes('section=chat_threads')) throw new ApiError(503, 'export_unavailable'); return base(path); });
    await expect(runExport(api(request), output, jest.fn(), new AbortController().signal)).rejects.toBeInstanceOf(ApiError);
    expect(output.append).toHaveBeenCalled(); expect(output.delete).toHaveBeenCalledTimes(1); expect(output.chunks).toEqual([]);
});
test('abort during append stops writes and deletes; an already aborted run never starts', async () => {
    const output = writer(), abort = new AbortController(), request = pages();
    output.append.mockImplementationOnce(() => { abort.abort(); });
    await expect(runExport(api(request), output, jest.fn(), abort.signal)).rejects.toThrow('export_cancelled');
    expect(output.delete).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledTimes(1);
    request.mockClear(); await expect(runExport(api(request), writer(), jest.fn(), abort.signal)).rejects.toThrow('export_cancelled');
    expect(request).not.toHaveBeenCalled();
});
test('throttle after three pages keeps the file and retries that page; Cancel interrupts the wait', async () => {
    jest.useFakeTimers();
    try {
        const output = writer(), base = pages(), progress = jest.fn(); let pageCalls = 0;
        const request = jest.fn(async (path: string) => {
            if (path.includes('?') && ++pageCalls === 4) throw new ApiError(429, 'read_throttled', { retryAfterSeconds: 120 });
            return base(path);
        });
        const run = runExport(api(request), output, progress, new AbortController().signal);
        await jest.advanceTimersByTimeAsync(0);
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ waiting: true }));
        expect(output.delete).not.toHaveBeenCalled(); expect(output.chunks.length).toBeGreaterThan(0);
        await jest.advanceTimersByTimeAsync(60000); await run;
        expect(request.mock.calls[4][0]).toBe(request.mock.calls[5][0]);
        expect(JSON.parse(output.chunks.join('')).sections.chat_threads).toHaveLength(2);
        const abort = new AbortController(), second = writer();
        const throttled = jest.fn(async (path: string) => { if (!path.includes('?')) return metadata(); throw new ApiError(429, 'read_throttled', { retryAfterSeconds: 30 }); });
        const pending = runExport(api(throttled), second, jest.fn(), abort.signal);
        const rejected = expect(pending).rejects.toThrow('export_cancelled');
        await jest.advanceTimersByTimeAsync(0); abort.abort(); await rejected;
        expect(second.delete).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
});
test('window expiry during a throttle deletes the partial file', async () => {
    jest.useFakeTimers();
    try {
        const output = writer();
        const request = jest.fn(async (path: string) => {
            if (!path.includes('?')) return { ...metadata(), expires_at: new Date(Date.now() + 1000).toISOString() };
            throw new ApiError(429, 'read_throttled', { retryAfterSeconds: 60 });
        });
        const run = runExport(api(request), output, jest.fn(), new AbortController().signal);
        const rejected = expect(run).rejects.toMatchObject({ code: 'export_expired' });
        await jest.advanceTimersByTimeAsync(1000); await rejected; expect(output.delete).toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});
test('network errors retry once; repeated cursors stop after 5000 pages', async () => {
    const output = writer(), request = pages(); request.mockRejectedValueOnce(new ApiError(0, 'network'));
    await runExport(api(request), output, jest.fn(), new AbortController().signal);
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
    const loop = jest.fn(async (path: string) => !path.includes('?') ? { ...metadata(), sections: ['creations'] } :
        { rows: [], next: { after: '2026-01-01T00:00:00Z', key: id } });
    const sink: ExportWriter = { create: jest.fn(), append: jest.fn(), delete: jest.fn() };
    await expect(runExport(api(loop), sink, jest.fn(), new AbortController().signal)).rejects.toThrow('export_page_limit');
    expect(loop).toHaveBeenCalledTimes(5001); expect(sink.delete).toHaveBeenCalled();
});
test('the 5,000-page guard counts message pages per thread, not across the account', async () => {
    const threads = ['t1', 't2'];
    const many = jest.fn(async (path: string) => {
        if (!path.includes('?')) return { ...metadata(), sections: ['chat_threads'] };
        const query = new URL('https://test' + path).searchParams;
        if (query.get('section') === 'chat_threads') return { rows: threads.map(t => ({ id: t })), next: null };
        const n = Number(query.get('after') ?? 0) + 1;
        return { rows: [{ seq: String(n) }], next: n < 3000 ? { after: String(n), key: null } : null };
    });
    const output = writer();
    await runExport(api(many), output, jest.fn(), new AbortController().signal);
    expect(JSON.parse(output.chunks.join('')).sections.chat_threads.map((t: { messages: unknown[] }) => t.messages.length)).toEqual([3000, 3000]);
    const endless = jest.fn(async (path: string) => {
        if (!path.includes('?')) return { ...metadata(), sections: ['chat_threads'] };
        if (path.includes('section=chat_threads')) return { rows: [{ id: 't1' }], next: null };
        return { rows: [], next: { after: '1', key: null } };
    });
    await expect(runExport(api(endless), writer(), jest.fn(), new AbortController().signal)).rejects.toThrow('export_page_limit');
    expect(endless).toHaveBeenCalledTimes(5002);
});
test.each([
    [401, 'not_authenticated', 'unavailable'], [403, 'mfa_required', 'mfa'], [403, 'account_restricted', 'restricted'],
    [404, 'not_found', 'unavailable'], [410, 'export_expired', 'expired'], [429, 'rate_limited', 'rate_limited'],
    [429, 'read_throttled', 'unavailable'], [503, 'gateway_not_configured', 'unavailable'], [0, 'network', 'unavailable'],
])('maps %s/%s without exposing codes', (status, code, expected) => {
    expect(exportErrorState(new ApiError(status as number, code as string))).toBe(expected);
});
