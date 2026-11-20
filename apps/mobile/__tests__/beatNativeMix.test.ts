import * as mix from '../src/lib/beatNative/mix';
import { createBeat, setTrackGain, tryOp, validateBeat, type BeatDoc } from '../src/lib/beatNative/doc';
import { fromUnit, toUnit } from '../src/components/beats/MixSlider';
// @ts-ignore web JavaScript modules
import * as ops from '../../../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
// @ts-ignore web JavaScript modules
import * as rules from '../../../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
// @ts-ignore web JavaScript modules
import * as controls from '../../../app/veyrnox/_lib/music/beat/beatMixControls.mjs';
// @ts-ignore web JavaScript modules
import * as automation from '../../../app/veyrnox/_lib/music/beat/beatAutomation.mjs';
// @ts-ignore web JavaScript modules
import { mixSignature } from '../../../app/veyrnox/_lib/music/beat/beatMixGraph.js';

const make = () => createBeat({ id: '00000000-0000-4000-8000-000000000051' });
test('seams retain identity with all web functions and constants', () => {
    for (const source of [ops, rules, controls, automation]) for (const key of Object.keys(mix)) {
        if (key in source) expect(mix[key as keyof typeof mix]).toBe(source[key]);
    }
    expect(mix.mixSignature).toBe(mixSignature);
});
test('all mix operations go through tryOp and retain a valid v4 document', () => {
    let doc = make();
    const apply = (operation: (d: BeatDoc) => BeatDoc) => {
        const result = tryOp(doc, operation);
        expect(result.refused).toBeUndefined(); expect(validateBeat(result.doc).ok).toBe(true); doc = result.doc;
    };
    for (const fx of ['eq', 'compressor', 'delay', 'reverb'] as const) apply(d => mix.addEffect(d, 't1', fx));
    apply(d => mix.setEffectBypass(d, 't1', 'f1', true));
    apply(d => mix.setEffectParam(d, 't1', 'f1', 'low', -4));
    apply(d => mix.moveEffect(d, 't1', 'f1', 1));
    apply(d => mix.removeEffect(d, 't1', 'f1'));
    apply(d => mix.setSend(d, 't1', 'reverb', 0.4));
    apply(d => mix.setSend(d, 't1', 'delay', 0.2));
    apply(d => mix.setMaster(d, { gain: 0.7, delay: { time: 0.3 } }));
    apply(d => mix.addAutomationPoint(d, 't1', 'gain', 0, 0.8));
    apply(d => mix.addAutomationPoint(d, 't1', 'gain', 480, 0.5));
    apply(d => mix.moveAutomationPoint(d, 't1', 'gain', 1, 720, 0.6));
    apply(d => mix.setAutomationCurve(d, 't1', 'gain', 0, -0.6));
    apply(d => mix.removeAutomationPoint(d, 't1', 'gain', 1));
    apply(d => mix.clearAutomation(d, 't1', 'gain'));
});
test('fifth effect, 65th point and out-of-order moves are refusals, leaving the doc intact', () => {
    let doc: BeatDoc = make();
    for (let i = 0; i < 4; i++) doc = mix.addEffect(doc, 't1', 'eq');
    let result = tryOp(doc, d => mix.addEffect(d, 't1', 'delay'));
    expect(result.refused).toBeTruthy(); expect(result.doc).toBe(doc);
    for (let i = 0; i < 64; i++) doc = mix.addAutomationPoint(doc, 't1', 'gain', i * 240, 0.5);
    result = tryOp(doc, d => mix.addAutomationPoint(d, 't1', 'gain', 64 * 240, 0.5));
    expect(result.refused).toBeTruthy(); expect(result.doc).toBe(doc);
    result = tryOp(doc, d => mix.moveAutomationPoint(d, 't1', 'gain', 0, 480, 0.5));
    expect(result.refused).toBeTruthy(); expect(result.doc).toBe(doc);
});
test('native signature rebuilds topology, drive, tempo and view but preserves live gain changes', () => {
    const doc = make(), fx = mix.addEffect(doc, 't1', 'distortion');
    expect(mix.nativeMixSignature(fx)).not.toBe(mix.nativeMixSignature(doc));
    expect(mix.nativeMixSignature(mix.setEffectParam(fx, 't1', 'f1', 'drive', 12))).not.toBe(mix.nativeMixSignature(fx));
    expect(mix.nativeMixSignature(setTrackGain(fx, 't1', 0.3))).toBe(mix.nativeMixSignature(fx));
    expect(mix.runKey({ ...fx, tempo: { bpm: 120 } })).not.toBe(mix.runKey(fx));
    expect(mix.runKey({ ...fx, view: 'pattern' } as mix.MixDoc)).not.toBe(mix.runKey(fx));
});
test('slider mapping is clamped, rounded and reversible across signed and unsigned ranges', () => {
    expect(toUnit(0, -1, 1)).toBe(0.5); expect(fromUnit(0.5, -1, 1, 0.01)).toBe(0);
    expect(fromUnit(0.51, -12, 12, 1)).toBe(0); expect(fromUnit(0.7, 0, 1, 0.01)).toBe(0.7);
    expect(fromUnit(-1, 0.02, 1, 0.01)).toBe(0.02); expect(fromUnit(2, 1, 20, 1)).toBe(20);
    expect(toUnit(100, 0, 1)).toBe(1);
});
