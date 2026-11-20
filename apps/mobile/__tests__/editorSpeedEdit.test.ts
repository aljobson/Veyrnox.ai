import { speedRate, speedCurve, speedReverse, freezeInsert, speedSourceBounds, isMovingClip } from '../src/lib/editorSpeedEdit';
import { trimItem } from '../src/lib/editorTimeline';
import { type Clip, type Timeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3 } from './fixtures/webSequenceV3';
import { setSequenceRate, setSequenceSpeedCurve, reverseSequenceClip, insertSequenceFreeze, trimSequence } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { SPEED_PRESETS, sourceFrame, sourceRange, shiftedSpeedKeys } from '../../../app/veyrnox/_lib/editorSpeed.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
const sel = { track: 'video' as const, id: 'v1' };
const take = (result: ReturnType<typeof speedRate>): Timeline => {
    expect(result).toHaveProperty('timeline');
    if (!('timeline' in result)) throw Error(result.refused);
    expect(validateSequence(result.timeline)).toBeNull(); return result.timeline;
};
test('wrappers equal the shared web operations and preserve their input', () => {
    const tl = webSequenceV3(), before = JSON.stringify(tl);
    expect(take(speedRate(tl, sel, 2))).toEqual(setSequenceRate(tl, 'video', 'v1', 2));
    expect(take(speedCurve(tl, sel, SPEED_PRESETS.accelerate))).toEqual(setSequenceSpeedCurve(tl, 'video', 'v1', SPEED_PRESETS.accelerate));
    expect(take(speedReverse(tl, sel))).toEqual(reverseSequenceClip(tl, 'video', 'v1'));
    expect(take(freezeInsert(tl, sel, 30))).toEqual(insertSequenceFreeze(tl, 'v1', 30));
    expect(take(speedRate(tl, sel, 2)).video[0]).toMatchObject({ keyframes: [], parameterKeyframes: [], maskKeyframes: [] });
    expect(JSON.stringify(tl)).toBe(before);
});
test('locked, outside and invalid operations refuse without mutation', () => {
    const tl = webSequenceV3(); tl.tracks[0].locked = true;
    const before = JSON.stringify(tl);
    for (const result of [speedRate(tl, sel, 2), speedCurve(tl, sel, SPEED_PRESETS.pulse), speedReverse(tl, sel), freezeInsert(tl, sel, 30)]) {
        expect(result).toEqual({ refused: 'locked' });
    }
    expect(JSON.stringify(tl)).toBe(before); tl.tracks[0].locked = false;
    expect(freezeInsert(tl, sel, 90)).toEqual({ refused: 'outside' });
    expect(speedRate(tl, sel, NaN)).toEqual({ refused: 'invalid' });
    tl.video[0].freezeFrame = 100; expect(isMovingClip(tl, sel)).toBe(false);
    expect(speedRate(tl, sel, 2)).toEqual({ refused: 'invalid' });
});
test.each(['accelerate', 'decelerate', 'pulse'] as const)('%s binary bounds match every integer candidate forward and reverse', preset => {
    for (const reverse of [false, true]) {
        const tl = webSequenceV3(); tl.media.m.frames = 300;
        let curved = take(speedCurve(tl, sel, SPEED_PRESETS[preset]));
        if (reverse) curved = take(speedReverse(curved, sel));
        const clip = curved.video[0];
        for (const edge of ['in', 'out'] as const) {
            const low = edge === 'in' ? -100 : 1 - clip.len, high = edge === 'in' ? clip.len - 1 : 400;
            const valid = [];
            for (let delta = low; delta <= high; delta++) {
                const candidate = { ...clip, len: clip.len + (edge === 'in' ? -delta : delta),
                    in: sourceFrame(clip, edge === 'in' ? delta : 0), speedCurve: shiftedSpeedKeys(clip, edge === 'in' ? delta : 0) };
                const range = sourceRange(candidate);
                if (range.from >= 0 && range.to < 300) valid.push(delta);
            }
            expect(speedSourceBounds(clip, tl.media.m, edge, low, high)).toEqual({ low: valid[0], high: valid.at(-1) });
            for (const delta of [1, 12]) {
                expect(trimItem(curved, sel, edge, delta, false, 0)).toEqual(trimSequence(curved, 'video', 'v1', edge, delta));
            }
        }
    }
});
test('freeze extends beyond the source and ripples only its lane even when ripple is off or all', () => {
    const tl = webSequenceV3(); tl.video[0] = { ...tl.video[0], in: 895, freezeFrame: 895, volume: 0 };
    tl.video.push({ id: 'v9', volume: 1, transition: 0, mediaId: 'm', trackId: 'video-0', start: 90, in: 0, len: 30 });
    for (const ripple of ['none', 'all'] as const) {
        const next = trimItem(tl, sel, 'out', 30, false, 0, ripple)!;
        expect(next.video[0].len).toBe(120); expect(next.video[2].start).toBe(120);
        expect(next.video[1]).toEqual(tl.video[1]); expect(validateSequence(next)).toBeNull();
    }
});
