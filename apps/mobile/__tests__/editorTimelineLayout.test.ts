import { hiddenLabelIds, trimHandleWidth, TRIM_HANDLE_MIN } from '../src/lib/editorTimelineLayout';
import { trimItem } from '../src/lib/editorTimeline';

describe('trimHandleWidth', () => {
    it('is at least 44 pt on a normal clip and never more than a third of the body each side', () => {
        expect(TRIM_HANDLE_MIN).toBe(44);
        expect(trimHandleWidth(400)).toBe(44);
    });
    it('shrinks on short clips so the two handles leave the middle for body drag', () => {
        expect(trimHandleWidth(90)).toBe(30);
        expect(trimHandleWidth(8)).toBe(2.67);
    });
});

describe('hiddenLabelIds', () => {
    const item = (id: string, start: number, len: number) => ({ id, start, len });
    it('hides the label of an item whose start is covered by a later item', () => {
        expect(hiddenLabelIds([item('title', 0, 90), item('cue', 0, 60)])).toEqual(new Set(['title']));
    });
    it('keeps every label when items do not cover each other starts', () => {
        expect(hiddenLabelIds([item('a', 0, 30), item('b', 30, 30)])).toEqual(new Set());
        expect(hiddenLabelIds([item('a', 0, 90), item('b', 40, 30)])).toEqual(new Set());
    });
});

describe('left trim keeps the clip in place at its end', () => {
    it('shortens the clip, keeps the out point', () => {
        const tl: any = { fps: 30, tracks: [{ id: 'v1', kind: 'video' }], audio: [], text: [], markers: [], media: { m: { kind: 'video', frames: 600 } },
            video: [{ id: 'c', trackId: 'v1', mediaId: 'm', start: 0, len: 450, in: 0 }] };
        const out = trimItem(tl, { track: 'video', id: 'c' }, 'in', 30, false, 0)!.video[0];
        expect(out).toMatchObject({ start: 30, len: 420, in: 30 });
        expect(out.start + out.len).toBe(450);
    });
});
