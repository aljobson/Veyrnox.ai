import { timelineOf, splitClip, type Timeline } from '../src/lib/nativeEditorModel';
import { trimItem } from '../src/lib/editorTimeline';
import { speedRate } from '../src/lib/editorSpeedEdit';
import { evaluatedTransform, evaluatedParameters, motionPreset, parameterKeyframe } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { evaluatedMask, maskKeyframe } from '../../../app/veyrnox/_lib/editorMask.mjs';
import { splitSequenceClip, trimSequence, setSequenceRate } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { webSequenceV3 } from './fixtures/webSequenceV3';
const selection = { track: 'video' as const, id: 'v1' };
const values = (tl: Timeline, frame: number) => {
    const c = tl.video.find(c => c.trackId === 'video-0' && frame >= c.start && frame < c.start + c.len)!;
    return [evaluatedTransform(c, frame - c.start, false), evaluatedMask(c, frame - c.start), evaluatedParameters(c, frame - c.start)];
};
test('split, in trim and out trim retain original absolute-time motion and equal web; rate clears all three arrays', () => {
    const before = timelineOf(webSequenceV3()), c = before.video[0];
    c.keyframes = motionPreset(c, 'arc');
    c.parameterKeyframes = [parameterKeyframe(c, 0), { ...parameterKeyframe(c, 89), brightness: 2, easing: 'ease-in' }];
    c.maskKeyframes = [maskKeyframe(c, 0), { ...maskKeyframe(c, 45), width: .4, easing: 'ease-out' }, maskKeyframe(c, 89)];
    let tl = splitClip(before, selection, 40)!;
    expect(tl).toEqual(splitSequenceClip(before, 'video', 'v1', 40));
    for (const frame of [0, 12, 39, 40, 55, 80, 89]) expect(values(tl, frame)).toEqual(values(before, frame));
    for (const [edge, delta] of [['in', 12], ['out', -9]] as const) {
        const prior = tl; tl = trimItem(tl, selection, edge, delta, false, 0)!;
        expect(tl).toEqual(trimSequence(prior, 'video', 'v1', edge, delta));
        expect(validateSequence(tl)).toBeNull();
        for (const frame of [12, 20, 30, 40, 80, 89]) expect(values(tl, frame)).toEqual(values(before, frame));
    }
    const result = speedRate(tl, selection, 2);
    expect(result).toEqual({ timeline: setSequenceRate(tl, 'video', 'v1', 2) });
    if (!('timeline' in result)) throw Error('refused');
    expect(result.timeline.video[0]).toMatchObject({ keyframes: [], parameterKeyframes: [], maskKeyframes: [] });
});
