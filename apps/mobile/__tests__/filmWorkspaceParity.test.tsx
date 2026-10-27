import { act, useEffect } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/workspace';
import { appCache, bindCacheUser, getCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import * as cloud from '../src/lib/filmCloud';
import * as store from '../src/lib/filmStudioStore';
import { emptyFilm, FILM_STAGES, parseFilm, SHOT_LANES, stageIssues, type Film } from '../src/lib/filmStudio';
import { newShot } from '../src/lib/filmStudioOptions';
import type { CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockPrevent = jest.fn();
const mockFetch = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
    usePreventRemove: (...args: unknown[]) => { mockPrevent(...args); return () => {}; } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: (...args: unknown[]) => mockFetch(...args) }));
void [useEffect, RN.View, RN.Text, RN.TextInput, RN.ScrollView, RN.Pressable, RN.Modal, RN.FlatList, RN.StyleSheet];
const model = (id: string, modality: string, over: Partial<CatalogModel> = {}): CatalogModel => ({ id, name: `Name ${id}`, modality, credits: 1, gated: false, durations: [10, 15], capabilities: { inputs: { prompt: { max: 4000 } } }, ...over });
const catalog = [model('image', 'text-to-image'), model('video', 'text-to-video'), model('fifteen', 'text-to-video', { durations: [15] }),
    model('gated', 'text-to-video', { gated: true }), model('short', 'text-to-video', { durations: [5] }),
    ...['clips', 'topic', 'plan_id'].map(key => model(key, 'text-to-video', { capabilities: { inputs: { prompt: {}, [key]: {} } } }))];
const id = '11111111-1111-4111-8111-111111111111';
const project = (revision = 1) => ({ project: { id, name: 'Cloud', shot_count: 0, revision, updated_at: null } });
let root: Root;
const textOf = (node: any): string => node.children.map((c: any) => typeof c === 'string' ? c : textOf(c)).join('');
const has = (text: string) => textOf(root.container).includes(text);
const controls = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const button = (label: string) => controls('button').find(n => n.props.accessibilityLabel === label || textOf(n) === label)!;
const field = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onChangeText)[0];
const click = async (node: any) => { expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
const press = async (label: string) => click(button(label));
const type = async (label: string, text: string) => { expect(field(label)).toBeDefined(); await act(async () => field(label).props.onChangeText(text)); };
async function pick(label: string, option: string) {
    await click(controls('button').find(n => String(n.props.accessibilityLabel ?? '').startsWith(`${label}, `)));
    await press(option);
}
async function stage(index: number) { await click(controls('tab').find(n => n.props.accessibilityLabel === FILM_STAGES[index][1])); }
async function tick(ms = 600) { await act(async () => { jest.advanceTimersByTime(ms); }); }
async function mount(film?: Film) {
    if (film) await store.saveStudio(JSON.stringify(film));
    root = createRoot(); await act(async () => root.render(<Screen />));
}
const saved = async () => (await cloud.loadActiveStudio())?.film;
function ready(): Film { const film = emptyFilm(); film.name = 'Film'; film.script = 'Script'; film.stack.image = 'image'; film.stack.video = 'video'; return film; }
function breakdownDone(): Film {
    const film = ready(); const shot = newShot(film);
    for (const [, fields] of SHOT_LANES) for (const [key] of fields) if (!shot[key]) shot[key] = 'value';
    Object.assign(shot, { location: '@room:v1', oneAction: true }); film.shots = [shot]; return film;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks(); resetCacheUser(); await wipeCache(); await bindCacheUser('alice');
    mockFetch.mockResolvedValue({ value: catalog }); mockRequest.mockResolvedValue(project());
    jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(async () => { if (root) await act(async () => root.unmount()); jest.restoreAllMocks(); resetCacheUser(); jest.useRealTimers(); });

test('setup shows only eligible models, stores ids, snaps seconds and exposes External text', async () => {
    await mount();
    await pick(t('film.imagemodel'), 'Name image');
    await click(controls('button').find(n => String(n.props.accessibilityLabel ?? '').startsWith(`${t('film.videomodel')}, `)));
    expect(has('Name gated')).toBe(false); expect(has('Name short')).toBe(false);
    for (const key of ['clips', 'topic', 'plan_id']) expect(has(`Name ${key}`)).toBe(false);
    await press('Name fifteen'); await tick();
    expect((await saved())?.stack).toMatchObject({ image: 'image', video: 'fifteen', seconds: '15' });
    await pick(t('filmWorkspace.videoWorkflow'), t('filmWorkspace.external'));
    expect(field(t('film.videomodel'))).toBeDefined(); expect(has(t('filmWorkspace.credentials'))).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
});
test('legacy workflow and model values remain visible without rewriting', async () => {
    const film = ready(); film.stack.image = 'Old Model'; film.stack.videoAccess = 'old provider';
    await mount(film); expect(has(t('filmWorkspace.legacyModel', { value1: 'Old Model' }))).toBe(true);
    expect(field(t('film.videomodel'))).toBeDefined(); await tick(); expect((await saved())?.stack).toEqual(film.stack);
});
test('catalog failure is quiet and Retry reloads it', async () => {
    mockFetch.mockRejectedValueOnce(new Error('secret error code')); await mount();
    expect(has(t('filmWorkspace.catalogUnavailable'))).toBe(true); expect(has('secret error code')).toBe(false);
    await press(t('filmWorkspace.retry')); expect(has(t('filmWorkspace.catalogUnavailable'))).toBe(false); expect(mockFetch).toHaveBeenCalledTimes(2);
});
test('stored models are not labelled missing while the catalog is loading or unavailable', async () => {
    const pending = deferred<{ value: CatalogModel[] }>(); mockFetch.mockReturnValueOnce(pending.promise);
    await mount(ready());
    for (const value of ['image', 'video']) expect(has(t('filmWorkspace.legacyModel', { value1: value }))).toBe(false);
    await act(async () => pending.resolve({ value: catalog }));
    expect(has('Name image')).toBe(true); expect(has('Name video')).toBe(true);
    await act(async () => root.unmount());
    mockFetch.mockRejectedValueOnce(new Error('unavailable')); await mount();
    expect(has(t('filmWorkspace.catalogUnavailable'))).toBe(true);
    for (const value of ['image', 'video']) expect(has(t('filmWorkspace.legacyModel', { value1: value }))).toBe(false);
    await tick(); expect((await saved())?.stack).toEqual(ready().stack);
});
test('later stages and Continue are disabled until issues clear', async () => {
    await mount();
    expect(controls('tab')[2].props.accessibilityState.disabled).toBe(true);
    expect(RN.StyleSheet.flatten(controls('tab')[2].props.style).opacity).toBeLessThan(1);
    expect(RN.StyleSheet.flatten(controls('tab')[0].props.style).opacity ?? 1).toBe(1);
    expect(button(t('filmWorkspace.continue', { value1: FILM_STAGES[1][1] })).props.accessibilityState.disabled).toBe(true);
    await pick(t('film.imagemodel'), 'Name image'); await pick(t('film.videomodel'), 'Name video');
    await press(t('filmWorkspace.continue', { value1: FILM_STAGES[1][1] }));
    expect(controls('tab')[1].props.accessibilityState.disabled).toBe(false);
    expect(RN.StyleSheet.flatten(controls('tab')[1].props.style).opacity ?? 1).toBe(1);
    expect(field(t('film.studioname')).props.maxLength).toBe(100);
    expect(has(t('filmWorkspace.frameFormat'))).toBe(false);
});
test('Add shot creates unique cards and shows one at a time', async () => {
    await mount(ready()); await stage(2); await press(t('film.addshot'));
    expect(field(t('filmStudio.sceneshotID')).props.value).toBe('sc01-sh01');
    await press(t('film.addshot')); expect(field(t('filmStudio.sceneshotID')).props.value).toBe('sc01-sh02');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('filmStudio.sceneshotID') && n.props.onChangeText)).toHaveLength(1);
    await tick(); expect((await saved())?.shots.map(s => s.id)).toEqual(['sc01-sh01', 'sc01-sh02']);
});
test('removing an accepted card keeps history reserved for the next card', async () => {
    const film = ready(); film.shots = [newShot(film)];
    film.prompts = [{ shot: 'sc01-sh01', version: 1, content: '', context: '', at: '' }];
    film.attempts = [{ shot: 'sc01-sh01', version: 1, result: 'take', changed: 'first', verdict: 'accepted', checks: ['References match', 'Anatomy and surfaces are clean', 'Camera follows the card', 'Performance and lip-sync hold', 'Continuity matches adjacent shots', 'Palette matches'], at: '' }];
    await mount(film); await stage(2); await press(t('film.remove')); await press(t('film.addshot')); await tick();
    expect((await saved())?.shots[0].id).toBe('sc01-sh02'); expect((await saved())?.attempts).toEqual(film.attempts);
});
test('id drafts strip spaces and retain the last valid id on format, duplicate and history errors', async () => {
    const film = ready(); film.shots = [newShot(film)]; film.shots.push(newShot(film));
    film.prompts = [{ shot: 'old', version: 1, content: '', context: '', at: '' }];
    await mount(film); await stage(2);
    await type(t('filmStudio.sceneshotID'), 'sc 01/!a');
    expect(field(t('filmStudio.sceneshotID')).props.value).toBe('sc01a');
    await act(async () => field(t('filmStudio.sceneshotID')).props.onBlur());
    await tick(); expect((await saved())?.shots[0].id).toBe('sc01a');
    for (const [id, problem] of [['_shot', 'format'], ['-a', 'format'], ['', 'format'], ['a'.repeat(62), 'format'], ['sc01-sh02', 'duplicate'], ['old', 'history']]) {
        await type(t('filmStudio.sceneshotID'), id);
        expect(has(t(`filmWorkspace.id.${problem}`))).toBe(false);
        await act(async () => field(t('filmStudio.sceneshotID')).props.onBlur()); await tick();
        expect(has(t(`filmWorkspace.id.${problem}`))).toBe(true); expect((await saved())?.shots[0].id).toBe('sc01a');
    }
});
test.each(['onBlur', 'onSubmitEditing'])('shot ids commit on %s and move only their own prompt and attempt history', async event => {
    const film = ready(); film.shots = [newShot(film)]; film.shots.push(newShot(film));
    film.prompts = film.shots.map(s => ({ shot: s.id, version: 1, content: 'prompt', context: 'context', at: '' }));
    film.attempts = film.shots.map(s => ({ shot: s.id, version: 1, result: 'take', changed: 'first', verdict: 'rejected', at: '' }));
    await mount(film); await stage(2);
    const label = t('filmStudio.sceneshotID');
    await type(label, 'sc01-sh0'); await tick();
    expect(await saved()).toEqual(film);
    await type(label, 'sc01-sh01');
    await act(async () => field(label).props[event]()); await tick();
    expect(await saved()).toEqual(film); expect(has(t('filmWorkspace.id.history'))).toBe(false);
    for (const id of ['renamed', 'sc01-sh01']) {
        await type(label, id); await act(async () => field(label).props[event]()); await tick();
        const next = (await saved())!;
        expect(next.shots.map(s => s.id)).toEqual([id, 'sc01-sh02']);
        expect(next.prompts).toEqual(film.prompts.map((p, i) => i === 0 ? { ...p, shot: id } : p));
        expect(next.attempts).toEqual(film.attempts.map((a, i) => i === 0 ? { ...a, shot: id } : a));
        expect(parseFilm(JSON.stringify(next)).ok).toBe(true);
    }
});
test('text task fields appear only with exact text, and lane inputs carry hints', async () => {
    await mount(ready()); await stage(2); await press(t('film.addshot'));
    expect(field(t('filmWorkspace.textPlacement'))).toBeUndefined();
    expect(field(t('filmStudio.description')).props.multiline).toBe(true);
    expect(has(t('filmWorkspace.assetHint'))).toBe(true); expect(has(t('filmWorkspace.durationHint'))).toBe(true);
    await type(t('filmWorkspace.exactText'), 'Welcome'); expect(field(t('filmWorkspace.textPlacement'))).toBeDefined();
    await type(t('filmWorkspace.exactText'), ''); expect(field(t('filmWorkspace.textContext'))).toBeUndefined();
});
test('Add shot is disabled at the schema cap', async () => {
    const film = ready(); for (let i = 0; i < 200; i++) film.shots.push(newShot(film));
    await mount(film); await stage(2); expect(button(t('film.addshot')).props.accessibilityState.disabled).toBe(true);
});
test('board scaffold allocates collision-free ids and reference edits reset approval', async () => {
    const film = breakdownDone(); film.boards = ['light', 'light-style'].map(id => ({ id, name: id + '-other', type: 'style', decision: 'approved', references: [] }));
    await mount(film); await stage(3); await press(t('film.createmissingboards')); await tick();
    let next = (await saved())!;
    expect(next.boards.find(b => b.name === 'light')?.id).toBe('light-style-2'); expect(parseFilm(JSON.stringify(next)).ok).toBe(true);
    await pick(t('filmWorkspace.board'), `light · ${t('filmWorkspace.revise')}`);
    await pick(t('filmWorkspace.decision'), t('filmWorkspace.approved'));
    await type(t('film.references'), '! bad.png | forbidden gloss\n good.png | matte'); await tick();
    next = (await saved())!;
    expect(next.boards.find(b => b.name === 'light')).toMatchObject({ decision: 'revise', references: [
        { source: 'bad.png', caption: 'forbidden gloss', kind: 'anti-reference' }, { source: 'good.png', caption: 'matte', kind: 'reference' }] });
    expect(has(t('filmWorkspace.banList'))).toBe(true); expect(has('forbidden gloss · bad.png')).toBe(true);
});
test('issues show twelve plus a remainder count', async () => {
    const film = ready(); film.shots = [newShot(film)]; await mount(film); await stage(2);
    expect(has(t('filmWorkspace.notShown', { value1: stageIssues(film, 2).length - 12 }))).toBe(true);
});
test('edits autosave at 600ms and blur flushes a pending edit', async () => {
    await mount(ready()); await stage(1); await type(t('film.studioname'), 'Changed');
    await tick(599); expect((await saved())?.name).toBe('Film'); expect(has(t('film.saving'))).toBe(true);
    await tick(1); expect((await saved())?.name).toBe('Changed'); expect(has(t('filmWorkspace.saved'))).toBe(true);
    await type(t('film.studioname'), 'Blurred'); await act(async () => root.unmount());
    expect((await saved())?.name).toBe('Blurred'); root = createRoot();
});
test('switching account cancels the timer, clears the old film, rejects old handlers and ignores late loads', async () => {
    await mount(ready()); await stage(1); await type(t('film.studioname'), 'Alice edit');
    const oldEdit = field(t('film.studioname')).props.onChangeText;
    const bob = deferred<{ film: Film; savedAt: number } | null>();
    jest.spyOn(cloud, 'loadActiveStudio').mockReturnValueOnce(bob.promise);
    const replace = jest.spyOn(cloud, 'replaceActiveStudio');
    await act(async () => bindCacheUser('bob')); expect(field(t('film.studioname'))).toBeUndefined();
    await act(async () => oldEdit('Stale')); await tick(); expect(replace).not.toHaveBeenCalled();
    await act(async () => bindCacheUser('carol'));
    await act(async () => bob.resolve({ film: { ...ready(), name: 'Bob late' }, savedAt: 1 }));
    expect(has('Bob late')).toBe(false); expect(field(t('film.studioname'))).toBeUndefined();
    expect(await store.loadStudio(appCache, 'carol')).toBeNull();
});
test('an initial load from an old account cannot repopulate the workspace', async () => {
    const old = deferred<{ film: Film; savedAt: number } | null>(); jest.spyOn(cloud, 'loadActiveStudio').mockReturnValueOnce(old.promise);
    await mount(); await act(async () => bindCacheUser('bob'));
    await act(async () => old.resolve({ film: ready(), savedAt: 1 }));
    expect(controls('tab')[1].props.accessibilityState.disabled).toBe(true); expect(getCacheUser()).toBe('bob');
});
const newConfirm = () => (RN.Alert.alert as jest.Mock).mock.calls.at(-1)[2][1].onPress as () => Promise<void>;
test('New confirmed after an account switch leaves the new film and cache alone', async () => {
    await mount(ready()); await press(t('film.new')); const confirm = newConfirm();
    await act(async () => bindCacheUser('bob'));
    const write = jest.spyOn(appCache, 'write'); await act(async () => confirm());
    expect(write).not.toHaveBeenCalled(); expect(getCacheUser()).toBe('bob');
});
test('New rechecks the owner after clearStudio resolves', async () => {
    await mount(ready()); const pending = deferred<void>();
    const clear = jest.spyOn(store, 'clearStudio').mockReturnValueOnce(pending.promise);
    await press(t('film.new')); let reset!: Promise<void>;
    await act(async () => { reset = newConfirm()(); });
    expect(clear).toHaveBeenCalledWith(appCache, 'alice');
    await act(async () => bindCacheUser('bob'));
    const bob = { ...ready(), name: 'Bob' }; await store.saveStudio(JSON.stringify(bob));
    await act(async () => { pending.resolve(); await reset; }); await tick();
    expect((await store.loadStudio(appCache, 'bob'))?.film.name).toBe('Bob');
    expect(controls('tab')[1].props.accessibilityState.disabled).toBe(true);
});
test('failed leave flush opens the Stay / Leave without saving alert', async () => {
    await mount(ready()); await stage(1);
    jest.spyOn(cloud, 'replaceActiveStudio').mockRejectedValue(new Error(t('filmWorkspace.saveFailed')));
    await type(t('film.studioname'), 'Unsaved');
    const repeat = jest.fn(); await act(async () => mockPrevent.mock.calls.at(-1)[1]({ repeat }));
    expect(RN.Alert.alert).toHaveBeenLastCalledWith(t('filmWorkspace.leaveTitle'), t('filmWorkspace.leaveBody'), expect.any(Array), { cancelable: false });
    expect(has(t('filmWorkspace.notSaved', { reason: t('filmWorkspace.saveFailed') }))).toBe(true);
    const choices = (RN.Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    expect(choices.map((c: any) => c.text)).toEqual([t('filmWorkspace.stay'), t('filmWorkspace.leave')]);
    await act(async () => choices[0].onPress()); expect(repeat).not.toHaveBeenCalled();
    await act(async () => mockPrevent.mock.calls.at(-1)[1]({ repeat }));
    await act(async () => (RN.Alert.alert as jest.Mock).mock.calls.at(-1)[2][1].onPress()); expect(repeat).toHaveBeenCalledTimes(1);
});
test('a cloud POST spanning unmount/remount and a second save creates one project then PUTs', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(project(2));
    await mount(ready()); await press(t('film.savetoaccount')); expect(mockRequest).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount()); await mount(); await stage(1); await type(t('film.studioname'), 'Newer');
    await press(t('film.savetoaccount')); expect(mockRequest).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(project()));
    expect(mockRequest.mock.calls.map(c => c[1].method)).toEqual(['POST', 'PUT']);
    expect(JSON.parse(mockRequest.mock.calls[1][1].body).expected_revision).toBe(1);
    expect(cloud.getOpenedFilm()).toMatchObject({ film: { name: 'Newer' }, cloud: { revision: 2 } });
});
test('a cloud response after newer autosave keeps the newer film and its new link', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise);
    await mount(ready()); await press(t('film.savetoaccount')); await stage(1); await type(t('film.studioname'), 'Newer'); await tick();
    await act(async () => pending.resolve(project()));
    expect(cloud.getOpenedFilm()).toMatchObject({ film: { name: 'Newer' }, cloud: { revision: 1 } });
    expect(has(t('filmWorkspace.memorySaved'))).toBe(true);
});
test('New during a pending cloud save cannot resurrect its link', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise);
    await mount(ready()); await press(t('film.savetoaccount')); await press(t('film.new')); await act(async () => newConfirm()());
    await act(async () => pending.resolve(project())); await tick();
    expect(cloud.getActiveCloudLink()).toBeNull(); expect((await saved())?.name).toBe('');
});

test('account save uses edits that arrived while its local flush was pending', async () => {
    await mount(ready()); await stage(1);
    const pending = deferred<void>(), original = cloud.replaceActiveStudio;
    jest.spyOn(cloud, 'replaceActiveStudio').mockImplementationOnce(async film => { await pending.promise; await original(film); });
    await type(t('film.studioname'), 'First'); await press(t('film.savetoaccount'));
    await type(t('film.studioname'), 'Latest');
    await act(async () => pending.resolve());
    expect(JSON.parse(JSON.parse(mockRequest.mock.calls[0][1].body).studio_json).name).toBe('Latest');
    expect(cloud.getOpenedFilm()?.film.name).toBe('Latest');
});

test('an old leave confirmation cannot cancel a new account’s pending edit', async () => {
    await mount(ready()); await stage(1);
    jest.spyOn(cloud, 'replaceActiveStudio').mockRejectedValueOnce(new Error(t('filmWorkspace.saveFailed')));
    await type(t('film.studioname'), 'Unsaved');
    const repeat = jest.fn(); await act(async () => mockPrevent.mock.calls.at(-1)[1]({ repeat }));
    const leave = (RN.Alert.alert as jest.Mock).mock.calls.at(-1)[2][1].onPress;
    await act(async () => bindCacheUser('bob'));
    await pick(t('film.imagemodel'), 'Name image');
    await act(async () => leave()); await tick();
    expect(repeat).not.toHaveBeenCalled(); expect((await store.loadStudio(appCache, 'bob'))?.film.stack.image).toBe('image');
});
