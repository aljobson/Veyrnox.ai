import { parseCrunTemplateSummary } from '../src/lib/crunTemplateSummary';

describe('CRUN template summary', () => {
    it('accepts the three live provider totals', () => {
        expect(parseCrunTemplateSummary({ total: 1088, providers: { kling: 226, seedance: 341, vidu: 521 } })).toEqual({
            total: 1088,
            providers: { kling: 226, seedance: 341, vidu: 521 },
        });
    });

    it.each([
        null,
        { total: -1, providers: {} },
        { total: 1088, providers: { kling: 226, seedance: 341 } },
        { total: 999, providers: { kling: 226, seedance: 341, vidu: 521 } },
    ])('rejects incomplete or invalid responses', (value) => {
        expect(parseCrunTemplateSummary(value)).toBeNull();
    });
});
