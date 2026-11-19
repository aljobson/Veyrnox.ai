import { fitToMedia, maxClipLength, trimItem } from '../src/lib/editorTimeline';
import { emptyTimeline, type Clip, type Media, type Timeline } from '../src/lib/nativeEditorModel';

// QA 6.2: a video or audio clip must never read past the end of its file, and `in` never goes below 0.
const FILE = 300;
const media = (patch: Partial<Media> = {}): Media => ({ id: 'm1', kind: 'video', frames: FILE, ...patch });
const make = (clip: Partial<Clip>, m: Media = media(), kind: 'video' | 'audio' = 'video'): Timeline => {
    const tl = emptyTimeline();
    tl.media = { [m.id]: m };
    tl[kind] = [{ id: 'c1', mediaId: m.id, start: 100, in: 0, len: 100, trackId: `${kind}-0`, ...clip }];
    return tl;
};
const sel = { track: 'video' as const, id: 'c1' };
const reads = (c: Clip) => (c.in ?? 0) + c.len;

describe('trim never runs past the file', () => {
    test('outward right trim stops at the end of the file', () => {
        const out = trimItem(make({ in: 50 }), sel, 'out', 5000, false, 0)!.video[0];
        expect(reads(out)).toBe(FILE);
    });
    test('outward left trim stops at in = 0 and keeps in + len', () => {
        const out = trimItem(make({ in: 40 }), sel, 'in', -500, false, 0)!.video[0];
        expect(out.in).toBe(0);
        expect(out.start).toBe(60);
        expect(reads(out)).toBe(140);
    });
    test('inward trims keep their behaviour', () => {
        const left = trimItem(make({ in: 10 }), sel, 'in', 20, false, 0)!.video[0];
        expect(left).toMatchObject({ start: 120, in: 30, len: 80 });
        const right = trimItem(make({ in: 10 }), sel, 'out', -30, false, 0)!.video[0];
        expect(right).toMatchObject({ start: 100, in: 10, len: 70 });
    });
    test('an already over-long clip is cut to the file by any trim, never grown', () => {
        const longer = make({ in: 100, len: 260 }); // reads to 360 of a 300-frame file
        const left = trimItem(longer, sel, 'in', -50, false, 0)!.video[0];
        expect(left.in).toBe(50);
        expect(reads(left)).toBeLessThanOrEqual(FILE);
        const right = trimItem(longer, sel, 'out', 40, false, 0)!.video[0];
        expect(reads(right)).toBeLessThanOrEqual(FILE);
    });
    test('slow and fast speeds count source frames, not timeline frames', () => {
        const slow = trimItem(make({ in: 0, len: 100, rate: 0.5 }), sel, 'out', 5000, false, 0)!.video[0];
        expect(slow.len).toBe(FILE / 0.5);
        const fast = trimItem(make({ in: 0, len: 50, rate: 2 }), sel, 'out', 5000, false, 0)!.video[0];
        expect(fast.len).toBe(FILE / 2);
    });
    test('audio clips are bounded the same way', () => {
        const tl = make({ in: 0, len: 100 }, media({ kind: 'audio' }), 'audio');
        expect(reads(trimItem(tl, { track: 'audio', id: 'c1' }, 'out', 9999, false, 0)!.audio[0])).toBe(FILE);
    });
    test('images are unbounded by the file', () => {
        const tl = make({ in: 0, len: 90 }, media({ kind: 'image', frames: 90 }));
        expect(trimItem(tl, sel, 'out', 200, false, 0)!.video[0].len).toBe(290);
    });
    test('unknown file length refuses the trim', () => {
        const tl = make({}, media({ frames: undefined }));
        expect(trimItem(tl, sel, 'out', 10, false, 0)).toBeNull();
    });
});

describe('maxClipLength and fitToMedia', () => {
    test('maxClipLength', () => {
        expect(maxClipLength(media(), { in: 100 })).toBe(200);
        expect(maxClipLength(media(), { in: 100, rate: 2 })).toBe(100);
        expect(maxClipLength(media(), { in: 100, reverse: true })).toBe(101);
        expect(maxClipLength(media({ kind: 'image' }), { in: 0 })).toBeNull();
        expect(maxClipLength(undefined, { in: 0 })).toBeNull();
        expect(maxClipLength(media({ frames: 0 }), { in: 0 })).toBeNull();
    });
    test('fitToMedia cuts over-long clips, clamps fades, leaves the rest alone', () => {
        const tl = make({ in: 100, len: 260, fadeOut: 250 });
        tl.video.push({ id: 'c2', mediaId: 'm1', start: 400, in: 0, len: 90, trackId: 'video-0' });
        const fitted = fitToMedia(tl);
        expect(fitted.video[0]).toMatchObject({ in: 100, len: 200, fadeOut: 200 });
        expect(fitted.video[1]).toBe(tl.video[1]);
    });
    test('fitToMedia raises a negative in to 0', () => {
        expect(fitToMedia(make({ in: -5, len: 50 })).video[0].in).toBe(0);
    });
});
