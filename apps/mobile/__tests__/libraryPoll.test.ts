import { applyStatus, inFlightIds, mergePage } from '../src/lib/libraryPoll';
import type { Job } from '../src/lib/media';
const job = (job_id: string, state: Job['state'] = 'queued'): Job => ({ job_id, state, credits: 10, model_id: 'model', created_at: '', has_asset: false });
test('in-flight ids have a limit and exclude terminal jobs', () => {
    expect(inFlightIds([job('a'), job('b', 'succeeded'), job('c', 'running')], 1)).toEqual(['a']);
});
test('unchanged status preserves the same array and row objects', () => {
    const rows = [job('a'), job('b')]; expect(applyStatus(rows, 'a', rows[0])).toBe(rows);
    const next = applyStatus(rows, 'a', { ...rows[0], state: 'failed', refunded: true, error_code: 'failed' });
    expect(next[0]).toMatchObject({ state: 'failed', refunded: true, error_code: 'failed' }); expect(next[1]).toBe(rows[1]);
});
test('page updates replace in place and preserve older rows with new ids first', () => {
    const rows = [job('a'), job('b'), job('old')]; const updated = job('b', 'succeeded');
    expect(mergePage(rows, [updated, job('new')])).toEqual([job('new'), rows[0], updated, rows[2]]);
});
