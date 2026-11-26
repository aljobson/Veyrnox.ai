import { coverJobId, projectCover } from '../src/lib/projectCover';

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

describe('projectCover', () => {
    const timeline = {
        schemaVersion: 3, fps: 30, seq: 0, aspect: '16:9', background: '#123456',
        media: {
            [`j-${A}`]: { id: `j-${A}`, kind: 'video', frames: 120 },
            [`j-${B}`]: { id: `j-${B}`, kind: 'video', frames: 120 },
        },
        video: [
            { id: 'v1', mediaId: `j-${A}`, start: 0, in: 0, len: 120, trackId: 'video-0' },
            { id: 'v2', mediaId: `j-${B}`, start: 60, in: 12, len: 60, trackId: 'video-1' },
        ],
        audio: [], text: [], markers: [], tracks: [
            { id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false },
            { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: false },
            { id: 'audio-0', kind: 'audio', name: 'Audio 1', locked: false, muted: false, hidden: false },
            { id: 'text-0', kind: 'text', name: 'Text 1', locked: false, muted: false, hidden: false },
        ],
    };

    it('uses the uppermost visual and exact source time from the saved cover frame', () => {
        expect(projectCover({ timeline, cover: { frame: 75, text: '  My cover  ', text_color: '#12aBcD' } })).toEqual({
            jobId: B, posterTimeSeconds: .9, text: 'My cover', textColor: '#12aBcD', background: '#123456',
        });
    });

    it('ignores a hidden upper layer at the saved frame', () => {
        const hidden = { ...timeline, tracks: timeline.tracks.map(track => track.id === 'video-1' ? { ...track, hidden: true } : track) };
        expect(projectCover({ timeline: hidden, cover: { frame: 75, text: '', text_color: '#FFFFFF' } })?.jobId).toBe(A);
    });

    it('retains the old first-media fallback when no cover was saved', () => {
        expect(projectCover({ timeline })).toEqual({ jobId: A, text: '', textColor: '#FFFFFF', background: '#000000' });
    });
});
