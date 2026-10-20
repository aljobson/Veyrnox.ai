import { ApiError } from '../src/lib/api';
import { fileNameFor, parseReports, reportsErrorKey } from '../src/lib/publishReports';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '/cache' } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

const ID = '0a1b2c3d-1111-4222-8333-444455556666';

describe('reports', () => {
    test('parses saved reports, drops rows without a real id or name, reads the export flag', () => {
        const r = parseReports({ reportExportsEnabled: true, templates: [{ id: ID, name: 'Monthly', range_days: 90, compare_previous: true, delivery_cadence: 'weekly', last_delivery_at: '2026-10-01T00:00:00Z' }, { id: 'not-a-uuid', name: 'x' }, { id: ID }] });
        expect(r.exportsEnabled).toBe(true);
        expect(r.reports).toHaveLength(1);
        expect(r.reports[0]).toMatchObject({ name: 'Monthly', rangeDays: 90, comparePrevious: true, cadence: 'weekly' });
        expect(parseReports({ templates: [] }).exportsEnabled).toBe(false);
        expect(parseReports(null).reports).toEqual([]);
    });
    test('the file name comes from the id only', () => {
        expect(fileNameFor(ID, 'pdf')).toBe('veyrnox-report-0a1b2c3d.pdf');
        expect(fileNameFor(ID, 'pptx')).toBe('veyrnox-report-0a1b2c3d.pptx');
    });
    test('error keys', () => {
        expect(reportsErrorKey(new ApiError(409, 'no_data'))).toBe('reports.err.noData');
        expect(reportsErrorKey(new ApiError(404, 'report_exports_not_open'))).toBe('reports.err.notOpen');
        expect(reportsErrorKey(new ApiError(502, 'export_invalid'))).toBe('reports.err.invalid');
        expect(reportsErrorKey(new Error('x'))).toBe('reports.err.share');
    });
});
