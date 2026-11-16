import { emptyTimeline, moveClip, type Clip, type TextClip, type Timeline } from '../src/lib/nativeEditorModel';

const clip = (id: string, start: number, len: number, trackId = 'video-0'): Clip => ({ id, mediaId: 'm1', start, in: 0, len, trackId });
const make = (...video: Clip[]): Timeline => ({ ...emptyTimeline(), seq: 9, video });
const starts = (timeline: Timeline) => Object.fromEntries(timeline.video.map((item) => [item.id, item.start]));

describe('moveClip', () => {
    it('swaps a clip with the next one and keeps the pair span', () => {
        const next = moveClip(make(clip('a', 0, 100), clip('b', 100, 40), clip('c', 140, 10)), { track: 'video', id: 'a' }, 1)!;
        expect(starts(next)).toEqual({ a: 40, b: 0, c: 140 });
    });

    it('moves the middle clip earlier', () => {
        const next = moveClip(make(clip('a', 0, 100), clip('b', 100, 40), clip('c', 140, 10)), { track: 'video', id: 'b' }, -1)!;
        expect(starts(next)).toEqual({ a: 40, b: 0, c: 140 });
    });

    it('keeps the gap between the two clips', () => {
        const next = moveClip(make(clip('a', 0, 30), clip('b', 50, 20)), { track: 'video', id: 'a' }, 1)!;
        expect(starts(next)).toEqual({ a: 40, b: 0 });
    });

    it('returns null at the lane ends and for an unknown clip', () => {
        const timeline = make(clip('a', 0, 30), clip('b', 30, 20));
        expect(moveClip(timeline, { track: 'video', id: 'a' }, -1)).toBeNull();
        expect(moveClip(timeline, { track: 'video', id: 'b' }, 1)).toBeNull();
        expect(moveClip(timeline, { track: 'video', id: 'zz' }, 1)).toBeNull();
    });

    it('refuses overlapping, nested and equal-start neighbours', () => {
        expect(moveClip(make(clip('a', 0, 100), clip('b', 20, 10)), { track: 'video', id: 'a' }, 1)).toBeNull();
        expect(moveClip(make(clip('a', 0, 50), clip('b', 40, 50)), { track: 'video', id: 'b' }, -1)).toBeNull();
        expect(moveClip(make(clip('a', 10, 20), clip('b', 10, 20)), { track: 'video', id: 'a' }, 1)).toBeNull();
    });

    it('only considers clips on the same lane', () => {
        const timeline = make(clip('a', 0, 30), clip('x', 30, 10, 'video-1'), clip('b', 30, 20));
        expect(starts(moveClip(timeline, { track: 'video', id: 'a' }, 1)!)).toEqual({ a: 20, x: 30, b: 0 });
    });

    it('does not mutate its input, never overlaps and is reversible', () => {
        const timeline = make(clip('a', 0, 30), clip('b', 40, 20));
        const frozen = JSON.stringify(timeline);
        const moved = moveClip(timeline, { track: 'video', id: 'a' }, 1)!;
        expect(JSON.stringify(timeline)).toBe(frozen);
        expect(moved.seq).toBe(timeline.seq);
        expect(starts(moveClip(moved, { track: 'video', id: 'a' }, -1)!)).toEqual(starts(timeline));
    });

    it('works for text clips', () => {
        const text = (id: string, start: number, len: number): TextClip => ({ id, text: id, start, len, trackId: 'text-0', x: .5, y: .5, size: 6 });
        const next = moveClip({ ...emptyTimeline(), text: [text('t1', 0, 10), text('t2', 10, 20)] }, { track: 'text', id: 't2' }, -1)!;
        expect(next.text.map((item) => [item.id, item.start])).toEqual([['t1', 20], ['t2', 0]]);
    });
});
