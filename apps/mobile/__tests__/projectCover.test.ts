import { coverJobId } from '../src/lib/projectCover';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('coverJobId', () => {
    it('covers a project with its first video clip', () => {
        const doc = { timeline: { audio: [{ mediaId: `j-${B}` }], video: [{ mediaId: `j-${A}` }, { mediaId: `j-${B}` }] } };
        expect(coverJobId(doc)).toBe(A);
    });
    it('falls back to audio, including stems', () => {
        expect(coverJobId({ timeline: { audio: [{ mediaId: `j-${B}--vocals` }] } })).toBe(B);
    });
    it('gives no cover for empty, malformed or non-job media', () => {
        expect(coverJobId(null)).toBeNull();
        expect(coverJobId({})).toBeNull();
        expect(coverJobId({ timeline: { video: [{ mediaId: 'upload-1' }, { mediaId: 7 }] } })).toBeNull();
        expect(coverJobId({ timeline: 'x' })).toBeNull();
    });
    it('finds media in unknown track groups', () => {
        expect(coverJobId({ timeline: { extras: { clips: [{ mediaId: `j-${A}` }] } } })).toBe(A);
    });
});
