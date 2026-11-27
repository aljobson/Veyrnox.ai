import { duplicateSelections, emptyTimeline, pasteClipboard, copySelections, splitClip, splitClipAtFrames, type Timeline, type Clip, type TextClip } from '../src/lib/nativeEditorModel';

const clip = (id: string, start: number, len: number, trackId = 'video-0'): Clip => ({ id, mediaId: 'm1', start, in: 0, len, trackId, volume: 1, transition: 0 });
const text = (id: string, start: number, len: number): TextClip => ({ id, text: 'Hi', start, len, trackId: 'text-0', x: .5, y: .5, size: 6 });
const base = (): Timeline => ({ ...emptyTimeline(), seq: 10, media: { m1: { id: 'm1', kind: 'video', frames: 600, name: 'Fixture', hasAudio: false, width: 1920, height: 1080 } }, video: [clip('v1', 0, 100), clip('v2', 100, 80)] });

/** True when two items on the same lane overlap. */
const overlaps = (timeline: Timeline) => (['video', 'audio', 'text'] as const).some((kind) => {
    const list = [...timeline[kind]].sort((a, b) => a.start - b.start);
    return list.some((item, index) => index > 0 && list[index - 1].start + list[index - 1].len > item.start && list[index - 1].trackId === item.trackId);
});
const total = (timeline: Timeline) => Math.max(0, ...[...timeline.video, ...timeline.audio, ...timeline.text].map((item) => item.start + item.len));

describe('editor timeline never overlaps on one track', () => {
    it('duplicate inserts the copy after the original and pushes later clips right', () => {
        const result = duplicateSelections(base(), [{ track: 'video', id: 'v1' }])!;
        const starts = result.timeline.video.map(({ id, start, len }) => [id, start, len]).sort((a, b) => Number(a[1]) - Number(b[1]));
        expect(starts.map((row) => row[1])).toEqual([0, 100, 200]);
        expect(starts[1][2]).toBe(100);
        expect(starts[2][0]).toBe('v2');
        expect(total(result.timeline)).toBe(280);
        expect(overlaps(result.timeline)).toBe(false);
    });

    it('split then duplicate the second piece does not cover the next clip', () => {
        const split = splitClip(base(), { track: 'video', id: 'v1' }, 40)!;
        const second = split.video.find((item) => item.start === 40)!;
        const result = duplicateSelections(split, [{ track: 'video', id: second.id }])!;
        expect(overlaps(result.timeline)).toBe(false);
        expect(total(result.timeline)).toBe(180 + 60);
        expect(result.timeline.video).toHaveLength(4);
    });

    it('paste on top of a clip makes room instead of overlapping', () => {
        const timeline = base();
        const pasted = pasteClipboard(timeline, copySelections(timeline, [{ track: 'video', id: 'v2' }]), 50)!;
        expect(overlaps(pasted.timeline)).toBe(false);
        expect(pasted.timeline.video).toHaveLength(4); // v1 is split at the insert point
        expect(total(pasted.timeline)).toBe(260);
    });

    it('all-track paste moves later captions by the inserted span without changing their content or word timing', () => {
        const caption = { ...text('t1', 100, 60), caption: true, words: [{ text: 'Hi', start: 0, len: 60 }], wordsEstimated: false };
        const timeline = { ...base(), text: [caption] };
        const result = pasteClipboard(timeline, copySelections(timeline, [{ track: 'video', id: 'v1' }]), 0, true)!;
        expect(result.timeline.video.map(({ start }) => start).sort((a, b) => a - b)).toEqual([0, 100, 200]);
        expect(result.timeline.text[0]).toEqual(expect.objectContaining({ start: 200, text: 'Hi', words: caption.words }));
        expect(overlaps(result.timeline)).toBe(false);
    });

    it('duplicating text keeps the text lane clear', () => {
        const timeline = { ...base(), text: [text('t1', 10, 30), text('t2', 40, 20)] };
        const result = duplicateSelections(timeline, [{ track: 'text', id: 't1' }])!;
        expect(overlaps(result.timeline)).toBe(false);
    });

    it('split never creates overlap', () => {
        expect(overlaps(splitClip(base(), { track: 'video', id: 'v2' }, 130)!)).toBe(false);
    });

    it('batches sorted unique scene cuts without changing the input', () => {
        const timeline = base(), frozen = JSON.stringify(timeline);
        const next = splitClipAtFrames(timeline, { track: 'video', id: 'v1' }, [70, 40, 70])!;
        expect(next.video.filter(item => item.start < 100).map(item => [item.start, item.len, item.in]).sort((a, b) => Number(a[0]) - Number(b[0])))
            .toEqual([[0, 40, 0], [40, 30, 40], [70, 30, 70]]);
        expect(next.seq).toBe(timeline.seq + 2); expect(overlaps(next)).toBe(false); expect(JSON.stringify(timeline)).toBe(frozen);
    });

    it('refuses the whole scene batch for invalid, endpoint or locked cuts', () => {
        const timeline = base(), locked = { ...timeline, tracks: timeline.tracks.map(track => track.id === 'video-0' ? { ...track, locked: true } : track) };
        for (const frames of [[], [0, 40], [40.5], [101]]) expect(splitClipAtFrames(timeline, { track: 'video', id: 'v1' }, frames)).toBeNull();
        expect(splitClipAtFrames(locked, { track: 'video', id: 'v1' }, [40])).toBeNull();
    });
});
