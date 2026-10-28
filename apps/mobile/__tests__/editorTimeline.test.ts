import { canTrim, fitPpf, formatTimecode, frameAtX, moveItems, parseTimecode, SEQUENCE_MAX, snapTo, trimItem } from '../src/lib/editorTimeline';
import { emptyTimeline, type Clip, type Timeline } from '../src/lib/nativeEditorModel';
const selected = { track: 'video' as const, id: 'v1' };
const fixture = (patch: Partial<Clip> = {}): Timeline => ({ ...emptyTimeline(), media: { m: { id: 'm', kind: 'video', frames: 300 } }, video: [{ id: 'v1', mediaId: 'm', trackId: 'video-0', start: 30, in: 30, len: 90, ...patch }] });

test('formats actual hours and parses every supported timecode form', () => {
    expect(formatTimecode(111694, 30)).toBe('01:02:03:04');
    for (const [text, frames] of [['01:02:03:04', 111694], ['02:03:04', 3694], ['02:03', 3690], ['12', 360], ['12.5', 375]] as const) expect(parseTimecode(text, 30)).toBe(frames);
    for (const text of ['00:00:00:30', '1:75', 'letters', '-1', '1.2.3', '60', '00:60:00', '00:60:00:00', '1:2:3:4:5', '', ' 1']) expect(parseTimecode(text, 30)).toBeNull();
});
test('clamps coordinates and fit zoom including empty sequences', () => {
    expect([frameAtX(-10, 2, 100), frameAtX(5, 2, 100), frameAtX(500, 2, 100), frameAtX(12, 2, 0)]).toEqual([0, 3, 99, 0]);
    expect([fitPpf(1, 18000), fitPpf(10000, 1), fitPpf(600, 150)]).toEqual([0.25, 8, 2]);
});
test('snaps the closest edge, includes playhead, excludes moving ids and ignores seven frames', () => {
    const tl = fixture();
    expect(snapTo(tl, [], 24, 10, 200)).toEqual({ at: 20, snapped: true });
    expect(snapTo(tl, [], 103, 12, 200)).toEqual({ at: 108, snapped: true });
    expect(snapTo(tl, ['v1'], 24, 10, 200)).toEqual({ at: 24, snapped: false });
    expect(snapTo(tl, [], 23, 1, 200)).toEqual({ at: 29, snapped: true });
    expect(snapTo(tl, [], 22, 1, 200)).toEqual({ at: 22, snapped: false });
    expect(snapTo(tl, [], 195, 10, 200)).toEqual({ at: 200, snapped: true });
});
test('moves a group by one bounded delta and drops out of range snapping', () => {
    const tl = fixture({ start: 5, len: 10 }); tl.video.push({ ...tl.video[0], id: 'v2', start: 50 });
    const both = [selected, { ...selected, id: 'v2' }];
    expect(moveItems(tl, both, both[1], -20, undefined, false, 0)?.video.map(c => c.start)).toEqual([0, 45]);
    tl.video[0].start = SEQUENCE_MAX - 60; tl.video[1].start = SEQUENCE_MAX - 15;
    expect(moveItems(tl, both, selected, 20, undefined, false, 0)?.video.map(c => c.start)).toEqual([SEQUENCE_MAX - 55, SEQUENCE_MAX - 10]);
    tl.video[0].start = 5; tl.video[1].start = 50;
    expect(moveItems(tl, both, both[1], -4, undefined, true, 42)?.video.map(c => c.start)).toEqual([0, 45]);
    expect(tl.video.map(c => c.start)).toEqual([5, 50]);
});
test('moves only dragged when not selected, restricts target lanes and respects locks', () => {
    const tl = fixture({ effect: { type: 'grain', intensity: 0.5 }, groupId: 'g1', filter: { blur: 2 } });
    tl.tracks.push({ ...tl.tracks[0], id: 'video-2' });
    const moved = moveItems(tl, [], selected, 30, 'video-2', false, 0)!;
    expect(moved.video[0]).toEqual({ ...tl.video[0], start: 60, trackId: 'video-2' });
    expect(moveItems(tl, [], selected, 0, 'audio-0', false, 0)?.video[0].trackId).toBe('video-0');
    tl.tracks[3].locked = true;
    expect(moveItems(tl, [], selected, 0, 'video-2', false, 0)?.video[0].trackId).toBe('video-0');
    tl.video.push({ ...tl.video[0], id: 'v2' }); tl.tracks[3].locked = false;
    expect(moveItems(tl, [selected, { ...selected, id: 'v2' }], selected, 1, 'video-2', false, 0)?.video.map(c => c.trackId)).toEqual(['video-0', 'video-0']);
    tl.video[1].trackId = 'video-2'; tl.tracks[3].locked = true;
    expect(moveItems(tl, [selected, { ...selected, id: 'v2' }], selected, 1, undefined, false, 0)).toBeNull();
    tl.tracks[0].locked = true;
    expect(moveItems(tl, [], selected, 1, undefined, false, 0)).toBeNull();
});
test.each([1, 2])('trims source start/end at rate %s with fades clamped and other fields retained', rate => {
    const tl = fixture({ rate, fadeIn: 45, fadeOut: 60, effect: { type: 'grain', intensity: 0.5 } });
    const trimmed = trimItem(tl, selected, 'in', 60, false, 0)!.video[0];
    expect(trimmed).toMatchObject({ start: 90, in: 30 + 60 * rate, len: 30, fadeIn: 30, fadeOut: 30, effect: tl.video[0].effect });
    expect(trimmed.fadeOut).toBeLessThanOrEqual(trimmed.len); expect(trimmed.len).toBeGreaterThanOrEqual(1);
    expect(trimItem(tl, selected, 'out', 500, false, 0)!.video[0].len).toBe(Math.floor(270 / rate));
    expect(trimItem(tl, selected, 'out', -500, false, 0)!.video[0].len).toBe(1);
    expect(trimItem(tl, selected, 'in', -500, false, 0)!.video[0]).toMatchObject({ start: 30 - 30 / rate, in: 0 });
    expect(tl.video[0].len).toBe(90);
});
test.each([1, 2])('reversed trims keep the top and bottom source frames inside the file at rate %s', rate => {
    const tl = fixture({ reverse: true, in: 200, rate });
    expect(trimItem(tl, selected, 'in', 20, false, 0)?.video[0]).toMatchObject({ start: 50, in: 200 - 20 * rate, len: 70 });
    expect(trimItem(tl, selected, 'out', 500, false, 0)?.video[0].len).toBe(Math.floor(200 / rate) + 1);
    tl.video[0].in = 299;
    expect(trimItem(tl, selected, 'in', -20, false, 0)?.video[0]).toMatchObject({ start: 30, in: 299 });
});
test('images and text can extend independently of source length; sequence and locked bounds apply', () => {
    const tl = fixture(); tl.media.m.kind = 'image';
    expect(trimItem(tl, selected, 'out', 500, false, 0)?.video[0].len).toBe(590);
    expect(trimItem(tl, selected, 'out', 20000, false, 0)?.video[0].len).toBe(SEQUENCE_MAX - 30);
    expect(trimItem(tl, selected, 'in', -100, false, 0)?.video[0].start).toBe(0);
    tl.tracks[0].locked = true; expect(trimItem(tl, selected, 'out', 1, false, 0)).toBeNull();
    tl.text = [{ id: 't1', start: 10, len: 30, text: 'Title', x: 0, y: 0, size: 5, trackId: 'text-0' }];
    expect(trimItem(tl, { track: 'text', id: 't1' }, 'in', -20, false, 0)?.text[0]).toMatchObject({ start: 0, len: 40 });
});
test('audio trims bound the file and snap only the moved edge', () => {
    const tl = fixture(); tl.media.m.kind = 'audio'; tl.audio = [{ ...tl.video[0], id: 'a1', trackId: 'audio-0' }]; tl.video = [];
    const selection = { track: 'audio' as const, id: 'a1' };
    expect(trimItem(tl, selection, 'out', 25, true, 150)?.audio[0].len).toBe(120);
    expect(trimItem(tl, selection, 'out', 500, false, 0)?.audio[0].len).toBe(270);
});
test.each(['words', 'keyframes', 'parameterKeyframes', 'maskKeyframes', 'speedCurve', 'offset', 'span'])('web timed field %s disables trims but permits moves', field => {
    const tl = fixture(); Object.assign(tl.video[0], ['offset', 'span'].includes(field) ? { animation: { [field]: 0 } } : { [field]: [] });
    expect(canTrim(tl.video[0])).toBe(false); expect(trimItem(tl, selected, 'out', 1, false, 0)).toBeNull();
    expect(moveItems(tl, [], selected, 1, undefined, false, 0)?.video[0]).toEqual({ ...tl.video[0], start: 31 });
});

test('still-media head trims retain the nonnegative in required by the save validator', () => {
    const tl = fixture({ in: 0 }); tl.media.m.kind = 'image';
    expect(trimItem(tl, selected, 'in', -20, false, 0)?.video[0]).toMatchObject({ start: 30, in: 0, len: 90 });
    expect(trimItem(tl, selected, 'out', 500, false, 0)?.video[0].len).toBe(590);
});
