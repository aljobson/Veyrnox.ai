import { createExportStore, type ExportRecord } from '../src/lib/editorServerExportStore';
import { sendExportAttempt } from '../src/lib/editorServerExport';
import type { ApiClient } from '../src/lib/api';
import type { CacheStorage } from '../src/lib/cache';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => '11111111-1111-4111-8111-111111111111', subscribeCacheUser: () => () => {} }));
const record = (): ExportRecord => ({ owner: A, projectId: B, key: A, credits: 5, sentAt: 100, body: { document: { project_id: B, schema_version: 3 }, resolution: '1080p', label: 'Export', quoted_credits: 5 } });
function setup() {
    const data = new Map<string, string>(); let owner: string | undefined = A, time = 100;
    const storage: CacheStorage = { get: async key => data.get(key) ?? null, set: async (key, value) => { data.set(key, value); }, remove: async key => { data.delete(key); }, keys: async () => [...data.keys()] };
    return { data, store: createExportStore(storage, () => owner, () => time), owner: (value?: string) => { owner = value; }, time: (value: number) => { time = value; } };
}
test('owner fence prevents reads and writes for another owner', async () => {
    const s = setup(); await s.store.write(record()); s.owner(B); expect(await s.store.read(B)).toBeNull(); await expect(s.store.write(record())).rejects.toMatchObject({ code: 'account_changed' });
});
test('six hour expiry removes a record', async () => {
    const s = setup(); await s.store.write(record()); s.time(6 * 3600000 + 101); expect(await s.store.read(B)).toBeNull(); expect(s.data.size).toBe(0);
});
test('40,000 byte limit counts UTF-8 and refuses before writing', async () => {
    const s = setup(), large = record(); large.body.label = '界'.repeat(14000);
    await expect(s.store.write(large)).rejects.toMatchObject({ code: 'render_too_large' }); expect(s.data.size).toBe(0);
});
test('mid-send recovery preserves the original body and key', async () => {
    const s = setup(), initial = record(); await s.store.write(initial); const recovered = await s.store.read(B);
    const request = jest.fn().mockResolvedValue({ job_id: B, state: 'running' });
    await sendExportAttempt({ request } as unknown as ApiClient, recovered!, () => true, 0);
    expect(request.mock.calls[0][1]).toMatchObject({ body: JSON.stringify(initial.body), headers: { 'Idempotency-Key': initial.key } });
});
