import { ApiError } from '../src/lib/api';
import { MIN_AGE, REPORT_CATEGORIES, reportErrorMessage, submitReport, validateReport, type ReportInput } from '../src/lib/account';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const job = (over: Partial<ReportInput> = {}): ReportInput => ({ kind: 'job', subjectId: ID, category: 'violence', details: '', ...over });

describe('report validation', () => {
    test('accepts a job report with no details', () => {
        expect(validateReport(job())).toBeNull();
    });
    test('needs a real id for a job and none for a general report', () => {
        expect(validateReport(job({ subjectId: null }))).not.toBeNull();
        expect(validateReport(job({ subjectId: 'not-a-uuid' }))).not.toBeNull();
        expect(validateReport({ kind: 'other', subjectId: ID, category: 'other', details: 'long enough text' })).not.toBeNull();
    });
    test('a general report needs at least 10 characters of detail', () => {
        const other = (details: string): ReportInput => ({ kind: 'other', subjectId: null, category: 'fraud', details });
        expect(validateReport(other('too short'))).not.toBeNull();
        expect(validateReport(other('   short   '))).not.toBeNull();
        expect(validateReport(other('this is long enough'))).toBeNull();
    });
    test('caps details at 2000 characters', () => {
        expect(validateReport(job({ details: 'x'.repeat(2001) }))).not.toBeNull();
        expect(validateReport(job({ details: 'x'.repeat(2000) }))).toBeNull();
    });
    test('categories match the server list', () => {
        expect(REPORT_CATEGORIES.map((c) => c.id)).toEqual(
            ['csam', 'intimate_image', 'real_person', 'violence', 'hate', 'fraud', 'copyright', 'other'],
        );
    });
    test('the age rule matches the privacy policy', () => {
        expect(MIN_AGE).toBe(18);
    });
});

describe('submitReport', () => {
    test('posts the server body shape and trims details', async () => {
        const request = jest.fn().mockResolvedValue({ report_id: 'r1', replayed: false });
        const out = await submitReport({ request }, job({ details: '  looks wrong  ' }));
        expect(out).toEqual({ replayed: false });
        const [path, init] = request.mock.calls[0];
        expect(path).toBe('/api/v1/reports');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ subject_kind: 'job', subject_id: ID, category: 'violence', details: 'looks wrong' });
    });
    test('reports a repeat as replayed', async () => {
        const request = jest.fn().mockResolvedValue({ report_id: 'r1', replayed: true });
        expect(await submitReport({ request }, job())).toEqual({ replayed: true });
    });
    test('does not call the server for an invalid report', async () => {
        const request = jest.fn();
        await expect(submitReport({ request }, job({ subjectId: null }))).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });
});

describe('reportErrorMessage', () => {
    test('maps known server errors to plain text', () => {
        expect(reportErrorMessage(new ApiError(429, 'too_many_open_reports'))).toMatch(/open reports/);
        expect(reportErrorMessage(new ApiError(429, 'rate_limited'))).toMatch(/Too many requests/);
        expect(reportErrorMessage(new ApiError(0, 'network'))).toMatch(/No connection/);
        expect(reportErrorMessage(new ApiError(502, 'reports_unavailable'))).toMatch(/did not send/);
        expect(reportErrorMessage(new Error('x'))).toMatch(/did not send/);
    });
});
