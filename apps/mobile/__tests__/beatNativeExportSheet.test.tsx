import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatExportSheet } from '../src/components/beats/BeatExportSheet';
import { t, APP_CATALOGS } from '../src/lib/i18n';
import english from '../src/lib/i18n/messages/en/beatExport';
import { fixedDoc } from './beatNativeFixtures';
import { addAudioRegion } from '../src/lib/beatNative/doc';
import { takeAsset } from '../src/lib/beatNative/takeShared';
import { takeRow } from './beatNativeTakeFixtures';
const mockReset = jest.fn();
const mockRun = jest.fn(), mockClose = jest.fn(), mockPush = jest.fn(), mockProbe = jest.fn();
let mockState: any;
jest.mock('../src/lib/beatNative/useBeatExport', () => ({ useBeatExport: () => mockState }));
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));
void [RN.View, RN.Text, RN.Pressable, RN.Modal, RN.TextInput];
let root: Root;
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof (n.props.onClick ?? n.props.onPress) === 'function')[0];
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const press = async (label: string) => { const b = button(label); await act(async () => (b.props.onClick ?? b.props.onPress)()); };
const render = async (recording = false, doc = fixedDoc()) => { await act(async () => root.render(<BeatExportSheet doc={doc} recording={recording} prepare={async () => {}} onClose={mockClose} />)); };
const disabled = (label: string) => { const b = button(label); return b.props.disabled ?? b.props.accessibilityState?.disabled; };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks();
    mockReset.mockImplementation(() => { mockState.saved = null; mockState.message = ''; mockState.state = 'ready'; });
    mockState = { state: 'ready', probe: 'on', message: '', busy: false, compressor: false, saved: null, percent: 0, offline: false, run: mockRun, retryProbe: mockProbe, resetSaved: mockReset };
});
afterEach(async () => { await act(async () => root.unmount()); });
test('song controls expose names/roles, disable cycle with hint, and preserve default stereo mix options', async () => {
    await render();
    expect(text(t('beatExport.deviceNote')).length).toBeGreaterThan(0);
    const cycle = `${t('beatExport.range')}: ${t('beatExport.cycle')}`;
    expect(disabled(cycle)).toBe(true); expect(text(t('beatExport.cycleHint')).length).toBeGreaterThan(0);
    await press(t('beatExport.render')); expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'song', output: 'mix', bitDepth: 16, range: 'song' }));
    await press(`${t('beatExport.kind')}: ${t('beatExport.pattern')}`);
    await press(`${t('beatExport.loops')}: ${t('beatExport.loopCount', { count: 4 })}`);
    await press(t('beatExport.render')); expect(mockRun).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'pattern', loops: 4 }));
});
test.each(['opening', 'unavailable'])('%s disables rendering and shows explicit copy', async state => {
    mockState.state = state; await render(); expect(disabled(t('beatExport.render'))).toBe(true); expect(text(t(`beatExport.${state}`)).length).toBeGreaterThan(0);
});
test('empty song and recording block export with reasons; busy blocks closing and announces progress', async () => {
    await render(true); expect(disabled(t('beatExport.render'))).toBe(true); expect(disabled(t('beatExport.save'))).toBe(true); expect(text(t('beatExport.recording')).length).toBeGreaterThan(0);
    await render(false, { ...fixedDoc(), tracks: [] }); expect(text(t('beatExport.empty')).length).toBeGreaterThan(0); expect(disabled(t('beatExport.render'))).toBe(true);
    mockState = { ...mockState, state: 'rendering', busy: true, percent: 50, message: t('beatExport.progress', { seconds: 5, total: 10 }) };
    await render(); expect(disabled(t('common.close'))).toBe(true);
    const bar = root.container.queryAll(n => n.props.accessibilityRole === 'progressbar')[0]; expect(bar.props.accessibilityValue.now).toBe(50);
});
test('off hides saving, offline keeps local share, and probe errors are retryable', async () => {
    mockState.probe = 'off'; await render(); expect(button(t('beatExport.save'))).toBeUndefined(); expect(text(t('beatExport.saveOff')).length).toBeGreaterThan(0);
    mockState.probe = 'on'; mockState.offline = true; await render(); expect(disabled(t('beatExport.save'))).toBe(true); expect(disabled(t('beatExport.render'))).toBe(false);
    mockState.probe = 'error'; await render(); await press(t('beat.retry')); expect(mockProbe).toHaveBeenCalled();
});
test('take rights are required only for the selected mix and save always receives mix title/rights', async () => {
    const doc = addAudioRegion(fixedDoc(), takeAsset(takeRow()), null, 0); await render(false, doc);
    expect(disabled(t('beatExport.save'))).toBe(true); await press(t('beatExport.rights')); expect(disabled(t('beatExport.save'))).toBe(false);
    await press(t('beatExport.save')); expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ range: 'song' }), { title: doc.title, rights: true });
});
test('error allows retry, saved result opens the existing Music song route, compressor note occurs once', async () => {
    mockState.state = 'error'; mockState.failedAction = 'share'; mockState.message = t('beatExport.source'); await render(); expect(text(mockState.message).length).toBeGreaterThan(0);
    await press(t('beatExport.retryShare')); expect(mockRun).toHaveBeenCalled();
    mockState.state = 'saved'; mockState.saved = { song_id: 'song-1' }; mockState.compressor = true; await render();
    await press(t('beatExport.openMusic')); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/[id]', params: { id: 'song-1' } }); expect(mockClose).toHaveBeenCalled();
    expect(text(t('beatExport.compressor'))).toHaveLength(1);
});
test.each(Object.entries(APP_CATALOGS))('%s provides every export string and placeholder without English fallback', (_locale, catalog) => {
    for (const [key, value] of Object.entries(english)) {
        const translated = (catalog as Record<string, string>)[key];
        expect(translated?.trim()).toBeTruthy(); expect((translated.match(/\{\w+\}/g) ?? []).sort()).toEqual((value.match(/\{\w+\}/g) ?? []).sort());
    }
});

test('N7-R2: Save is disabled after success; title and range edits reset the saved selection', async () => {
    const doc = { ...fixedDoc(), cycle: { on: true, start: 0, end: 3840 } };
    mockState.saved = { song_id: 'saved' }; mockState.state = 'saved'; await render(false, doc);
    expect(disabled(t('beatExport.save'))).toBe(true);
    const input = root.container.queryAll(n => n.props.accessibilityLabel === t('beatExport.songTitle') && typeof n.props.onChangeText === 'function')[0];
    await act(async () => input.props.onChangeText('Edited title'));
    expect(mockReset).toHaveBeenCalledTimes(1); expect(disabled(t('beatExport.save'))).toBe(false);
    mockState.saved = { song_id: 'saved-again' }; await render(false, doc);
    await press(`${t('beatExport.range')}: ${t('beatExport.cycle')}`);
    expect(mockReset).toHaveBeenCalledTimes(2); expect(disabled(t('beatExport.save'))).toBe(false);
});
test('N7-R4: replacement blocks both actions with a reason', async () => {
    await act(async () => root.render(<BeatExportSheet doc={fixedDoc()} recording={false} replacing prepare={async () => {}} onClose={mockClose} />));
    expect(disabled(t('beatExport.render'))).toBe(true); expect(disabled(t('beatExport.save'))).toBe(true);
    expect(text(t('beatTakes.replacing')).length).toBeGreaterThan(0);
});

test('N7-RV-004: the English Close label exists and closes the sheet', async () => {
    await render(); expect(t('common.close')).toBe('Close');
    expect(button('Close')).toBeDefined(); await press('Close'); expect(mockClose).toHaveBeenCalledTimes(1);
});
test.each(['share', 'save'])('N7-RV-005: failed %s exposes the correct retry with the original title and rights', async failedAction => {
    const doc = addAudioRegion(fixedDoc(), takeAsset(takeRow()), null, 0); await render(false, doc);
    await press(t('beatExport.rights'));
    await press(t(failedAction === 'save' ? 'beatExport.save' : 'beatExport.render'));
    const original = mockRun.mock.calls[0]; mockRun.mockClear();
    mockState.state = 'error'; mockState.failedAction = failedAction; await render(false, doc);
    if (failedAction === 'save') {
        expect(button(t('beatExport.retryShare'))).toBeUndefined(); expect(button(t('beatExport.render'))).toBeDefined();
        await press(t('beatExport.retrySave'));
        expect(mockRun).toHaveBeenCalledWith(original[0], { title: doc.title, rights: true });
    } else {
        expect(button(t('beatExport.retrySave'))).toBeUndefined(); await press(t('beatExport.retryShare'));
        expect(mockRun).toHaveBeenCalledWith(original[0]);
    }
});
test('N7-RV-006: phone save failures direct people to Render and share', () => {
    for (const key of ['saveError', 'size', 'sourceUnavailable', 'frozen'] as const) {
        expect(english[`beatExport.${key}`]).toContain(english['beatExport.render']);
        expect(english[`beatExport.${key}`]).not.toMatch(/download/i);
        for (const catalog of Object.values(APP_CATALOGS)) {
            expect((catalog as Record<string, string>)[`beatExport.${key}`]).toContain((catalog as Record<string, string>)['beatExport.render']);
        }
    }
});
