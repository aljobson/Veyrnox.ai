import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import BeatEditor from '../src/app/(app)/beats/[id]';
import { BeatAutomationLane } from '../src/components/beats/BeatAutomationLane';
import { BeatMeter } from '../src/components/beats/BeatMeter';
import { MixSlider } from '../src/components/beats/MixSlider';
import { t } from '../src/lib/i18n';
import { newBeat, getBeat, putBeat, resetBeats } from '../src/lib/beatNative/store';
import { tryOp, validateBeat } from '../src/lib/beatNative/doc';
import * as history from '../src/lib/beatNative/history';
import { addAutomationPoint, addEffect, type MixDoc, type MixApply, type MixTrack } from '../src/lib/beatNative/mix';

jest.mock('../src/lib/beatNative/persist', () => ({ ...jest.requireActual('../src/lib/beatNative/persist'), documentFiles: () => ({ read: async () => null, write: async () => undefined, remove: async () => undefined, list: async () => [] }) }));
const mockGetAccessToken = jest.fn(async () => '');
const mockApi = { request: jest.fn(async () => ({ projects: [] })) };
const mockAudio = { play: jest.fn(async (..._args: unknown[]) => undefined), stop: jest.fn(), isPlaying: () => true, hitPad: jest.fn(), setTrackMix: jest.fn(), close: jest.fn(async () => undefined), meterTap: () => null, context: {} };
let mockParams = { id: 'x' };
let mockReduced = true;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: mockGetAccessToken, generation: 0 }) }));
jest.mock('expo-router', () => ({ Link: ({ children }: { children: unknown }) => children, Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams }));
jest.mock('../src/lib/beatNative/audio', () => ({ createBeatAudio: () => mockAudio }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
void [RN.View, RN.ScrollView, RN.Pressable, RN.Text, RN.Modal];
let root: Root;
const nodes = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label);
const button = (label: string) => nodes(label).find(n => typeof (n.props.onClick ?? n.props.onPress) === 'function');
const press = async (label: string) => {
    const n = button(label); if (!n) throw new Error(`Missing control: ${label}`);
    await act(async () => { (n.props.onClick ?? n.props.onPress)({ nativeEvent: {} }); });
};
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const slider = (label: string) => nodes(label).find(n => n.props.accessibilityRole === 'adjustable')!;
const adjust = async (label: string, actionName: string) => {
    const n = slider(label); expect(n).toBeDefined();
    await act(async () => n.props.onAccessibilityAction({ nativeEvent: { actionName } }));
};
const open = async (prepare?: (d: MixDoc) => MixDoc) => {
    let doc = newBeat('Mix') as MixDoc; if (prepare) { doc = prepare(doc); putBeat(doc); }
    mockParams = { id: doc.id };
    await act(async () => root.render(<BeatEditor />)); return doc;
};
const current = () => getBeat(mockParams.id) as MixDoc;
const track = () => current().tracks[0] as MixTrack;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); resetBeats(); jest.clearAllMocks(); mockReduced = true;
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

test('opens the full sheet, adds effects through the store/history, and undo restores', async () => {
    const recorded = jest.spyOn(history, 'record'); await open();
    await press(t('beatMix.title')); expect(button(t('beatMix.close'))).toBeDefined();
    expect(text(t('beatMix.fx.empty')).length).toBeGreaterThan(0);
    await press(t('beatMix.fx.add', { effect: t('beatMix.fx.eq') }));
    expect(track().fx?.[0].type).toBe('eq'); expect(validateBeat(current()).ok).toBe(true);
    expect(recorded).toHaveBeenCalledTimes(1); expect(recorded.mock.results[0].value.past).toHaveLength(1);
    await press(t('beatMix.close')); await press(t('beat.undo')); expect(track().fx).toBeUndefined();
});
test('G2 offers no Drive control; G1 notices appear for compressor and limiter', async () => {
    await open(); await press(t('beatMix.title'));
    await press(t('beatMix.fx.add', { effect: t('beatMix.fx.distortion') }));
    expect(text(t('beatMix.fx.distortion.web')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && /drive/i.test(n.props.accessibilityLabel ?? ''))).toHaveLength(0);
    await press(t('beatMix.fx.add', { effect: t('beatMix.fx.compressor') }));
    expect(text(t('beatMix.fx.compressor.standIn')).length).toBeGreaterThan(0);
    expect(text(t('beatMix.limiter.standIn')).length).toBeGreaterThan(0);
    expect(current().master).toBeUndefined(); await press(t('beatMix.limiter')); expect(current().master?.limiter).toBe(false);
});
test('both mixer entry points disable automated gain and pan with translated reasons', async () => {
    await open(d => addAutomationPoint(addAutomationPoint(d, 't1', 'gain', 0, 0.8), 't1', 'pan', 0, 0));
    for (const lane of ['gain', 'pan'] as const) {
        const old = t(`beat.${lane}`, { track: t('beat.track', { n: 1 }) });
        expect(slider(old).props.accessibilityState.disabled).toBe(true);
        await adjust(old, 'decrement'); expect(track()[lane]).toBe(lane === 'gain' ? 1 : 0);
    }
    await press(t('beatMix.title'));
    for (const lane of ['gain', 'pan'] as const) {
        expect(slider(t(`beat.${lane}`, { track: track().name })).props.accessibilityState.disabled).toBe(true);
        expect(text(t(`beatMix.locked.${lane}`)).length).toBeGreaterThan(0);
    }
});
test.each([false, true])('slider edits coalesce into one history entry and undo restores (sheet %s)', async sheet => {
    const recorded = jest.spyOn(history, 'record'); await open();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    if (sheet) await press(t('beatMix.title'));
    const label = t('beat.gain', { track: sheet ? track().name : t('beat.track', { n: 1 }) });
    await adjust(label, 'decrement'); await adjust(label, 'decrement'); await adjust(label, 'decrement');
    expect(track().gain).toBe(0.7); expect(recorded).toHaveBeenCalledTimes(3);
    for (const call of recorded.mock.calls) expect(call[2]?.key).toBe('t1:gain');
    expect(recorded.mock.results.at(-1)!.value.past).toHaveLength(1);
    if (sheet) await press(t('beatMix.close'));
    await press(t('beat.undo')); expect(track().gain).toBe(1);
    await press(t('beat.redo')); expect(track().gain).toBe(0.7);
});
test('adds/selects/moves/curves/deletes automation points and clears the lock', async () => {
    await open(); await press(t('beatMix.title')); await press(t('beatMix.lane.show.gain'));
    await press(t('beatMix.lane.add')); expect(track().automation?.gain).toEqual([[0, 1, 0]]);
    await press(t('beatMix.lane.add')); expect(track().automation?.gain?.map(p => p[0])).toEqual([0, 240]);
    const label = t('beatMix.lane.point', { lane: t('beatMix.lane.gain'), n: 2, bar: 1, beat: 1.25, value: t('beatMix.unit.percent', { value: 100 }) });
    await press(label); expect(button(t('beatMix.lane.earlier'))?.props.accessibilityState.disabled).toBe(true);
    await press(t('beatMix.lane.later')); expect(track().automation?.gain?.[1][0]).toBe(480);
    await press(t('beatMix.lane.decrease', { value: t('beatMix.unit.percent', { value: 10 }) }));
    expect(track().automation?.gain?.[1][1]).toBe(0.9);
    await press(t('beatMix.curve.in')); expect(track().automation?.gain?.[1][2]).toBe(-0.6);
    await press(t('beatMix.lane.delete')); expect(track().automation?.gain).toHaveLength(1);
    await press(t('beatMix.lane.clear')); expect(track().automation).toBeUndefined();
    expect(slider(t('beat.gain', { track: track().name })).props.accessibilityState.disabled).toBe(false);
    await press(t('beatMix.lane.hide')); expect(button(t('beatMix.lane.add'))).toBeUndefined();
});
test('effect order, bypass, removal and four-effect limit use shared operations', async () => {
    await open(); await press(t('beatMix.title'));
    for (const type of ['eq', 'compressor', 'delay', 'reverb']) await press(t('beatMix.fx.add', { effect: t(`beatMix.fx.${type}`) }));
    expect(button(t('beatMix.fx.add', { effect: t('beatMix.fx.eq') }))?.props.accessibilityState.disabled).toBe(true);
    expect(text(t('beatMix.fx.limit')).length).toBeGreaterThan(0);
    const name = t('beatMix.fx.name', { effect: t('beatMix.fx.eq'), n: 1 });
    await press(t('beatMix.fx.bypass', { effect: name })); expect(track().fx?.[0].bypass).toBe(true);
    await press(t('beatMix.fx.down', { effect: name })); expect(track().fx?.[1].type).toBe('eq');
    await press(t('beatMix.fx.remove', { effect: t('beatMix.fx.name', { effect: t('beatMix.fx.eq'), n: 2 }) }));
    expect(track().fx).toHaveLength(3);
});
test('send, effect parameter and master drags carry separate history keys', async () => {
    const recorded = jest.spyOn(history, 'record'); await open(d => addEffect(d, 't1', 'eq')); await press(t('beatMix.title'));
    const changes = [
        [t('beatMix.send.reverb'), 't1:send:reverb'], [t('beatMix.send.delay'), 't1:send:delay'],
        [t('beatMix.fx.param', { effect: t('beatMix.fx.name', { effect: t('beatMix.fx.eq'), n: 1 }), param: t('beatMix.param.low') }), 't1:fx:f1:low'],
        [t('beatMix.master.gain'), 'master:gain'], [t('beatMix.master.time'), 'master:delay.time'], [t('beatMix.master.feedback'), 'master:delay.feedback'],
    ];
    for (const [label, key] of changes) {
        await adjust(label, 'increment'); expect(recorded.mock.calls.at(-1)?.[2]?.key).toBe(key);
    }
    expect(track().sends?.reverb).toBe(0.1); expect(track().fx?.[0].params.low).toBe(2); expect(current().master).toBeDefined();
    expect(validateBeat(current()).ok).toBe(true);
});
test('lane taps snap to sixteenths and use envelope values; playing Add point uses play position', async () => {
    let doc = addAutomationPoint(newBeat('Lane'), 't1', 'pan', 0, -1);
    doc = addAutomationPoint(doc, 't1', 'pan', 960, 1);
    const apply: MixApply = operation => { const result = tryOp(doc, operation); if (result.refused) return false; doc = result.doc as MixDoc; return true; };
    const render = () => root.render(<BeatAutomationLane doc={doc} track={doc.tracks[0]} lane="pan" step={2} playing apply={apply} onHide={() => {}} />);
    await act(async () => render()); await press(t('beatMix.lane.add'));
    expect((doc.tracks[0] as MixTrack).automation?.pan?.[1]).toEqual([480, 0, 0]);
    await act(async () => render());
    const surface = button(t('beatMix.lane.surface', { lane: t('beatMix.lane.pan') }))!;
    await act(async () => (surface.props.onClick ?? surface.props.onPress)({ nativeEvent: { locationX: 22 + 720 / (64 * 240) } }));
    expect((doc.tracks[0] as MixTrack).automation?.pan?.find(p => p[0] === 720)?.[1]).toBeCloseTo(0.5);
});
test('an audio timer error shows the existing audio notice and resets transport', async () => {
    await open(); await press(t('beat.play'));
    const error = mockAudio.play.mock.calls[0][2] as (error: unknown) => void;
    await act(async () => error(new Error('audio failed')));
    expect(text(t('beat.audioError')).length).toBeGreaterThan(0); expect(button(t('beat.play'))).toBeDefined();
});
test('meter exposes accessible text and hides the bar for reduced motion', async () => {
    await act(async () => root.render(<BeatMeter audio={null} trackId="master" name="Master" />));
    const meter = nodes(t('beatMix.meter.label', { track: 'Master' })).find(n => n.props.accessibilityRole === 'progressbar');
    expect(meter?.props.accessibilityValue.text).toBe(t('beatMix.meter.value', { value: '−∞' }));
    expect(root.container.queryAll(n => n.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(0);
    mockReduced = false; await act(async () => root.render(<BeatMeter audio={null} trackId="master" name="Master" />));
    expect(root.container.queryAll(n => n.props.importantForAccessibility === 'no-hide-descendants').length).toBeGreaterThan(0);
});
test('mixer sliders read their own value and unit to the screen reader', async () => {
    await act(async () => root.render(<MixSlider label="Threshold" value={-24} min={-60} max={0} step={1} unit="db" onChange={() => undefined} />));
    expect(slider('Threshold').props.accessibilityValue.text).toBe(t('beatMix.unit.db', { value: -24 }));
    await act(async () => root.render(<MixSlider label="Pan" value={0} min={-1} max={1} onChange={() => undefined} />));
    expect(slider('Pan').props.accessibilityValue.text).toBe(t('beatMix.unit.percent', { value: 0 }));
});
