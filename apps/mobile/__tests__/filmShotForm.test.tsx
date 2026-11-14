import { act, useEffect } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/workspace';
import { appCache, bindCacheUser, getCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import * as cloud from '../src/lib/filmCloud';
import * as store from '../src/lib/filmStudioStore';
import { emptyFilm, FILM_STAGES, parseFilm, SHOT_LANES, stageIssues, type Film } from '../src/lib/filmStudio';
import { fillShotDefaults, newShot, scriptBeats } from '../src/lib/filmStudioOptions';
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
test('typing into a shot field keeps the same input mounted (scroll and focus survive)', async () => {
    await mount(ready()); await stage(2); await press(t('film.addshot'));
    const before = field(t('filmStudio.locationasset'));
    await type(t('filmStudio.locationasset'), '@r');
    await tick(); await tick(1000);
    expect(field(t('filmStudio.locationasset')).props.value).toBe('@r');
    expect(field(t('filmStudio.locationasset'))).toBe(before);
});
test('the shot list shows Shot 1, Shot 2 while the stored id stays the raw id', async () => {
    const film = ready(); film.shots = [newShot(film)]; film.shots.push(newShot({ ...film, shots: film.shots }));
    await mount(film); await stage(2);
    expect(controls('button').some(n => String(n.props.accessibilityLabel ?? '').startsWith(`${t('filmWorkspace.shotCards')}, ${t('filmWorkspace.shotLabel', { value1: 1 })}`))).toBe(true);
    expect(field(t('filmStudio.sceneshotID')).props.value).toBe('sc01-sh01');
    await tick(); expect((await saved())?.shots.map(s => s.id)).toEqual(['sc01-sh01', 'sc01-sh02']);
});
test('Fill sensible defaults fills only empty fields, keeps typed values and leaves the one-action box for the user', async () => {
    await mount(ready()); await stage(2); await press(t('film.addshot'));
    await tick();
    expect(stageIssues((await saved())!, 2).length).toBeGreaterThan(1);
    await type(t('filmStudio.description'), 'Maya pours the first coffee. She smiles.');
    await type(t('filmStudio.timeofday'), 'Dusk');
    const requestsBefore = mockRequest.mock.calls.length, catalogCallsBefore = mockFetch.mock.calls.length;
    await press(t('filmWorkspace.fillDefaults'));
    expect(has(t('filmWorkspace.defaultsFilledRemaining', { value1: 14, value2: 1 }))).toBe(true);
    await tick(100);
    expect(RN.AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t('filmWorkspace.defaultsFilledRemaining', { value1: 14, value2: 1 }));
    expect(field(t('filmStudio.timeofday')).props.value).toBe('Dusk');
    expect(field(t('filmStudio.description')).props.value).toBe('Maya pours the first coffee. She smiles.');
    expect(field(t('filmStudio.shotgoal')).props.value).toBe('Show: Maya pours the first coffee. She smiles.');
    expect(field(t('filmStudio.locationasset')).props.value).toBe('');
    expect(mockRequest).toHaveBeenCalledTimes(requestsBefore);
    expect(mockFetch).toHaveBeenCalledTimes(catalogCallsBefore);
    await tick();
    const shot = (await saved())!.shots[0];
    expect(shot.oneAction).toBe(false);
    const issues = stageIssues((await saved())!, 2);
    expect(issues).toContain('sc01-sh01: ' + t('filmStudio.confirmthattheclipcontainsoneaction'));
    expect(issues.some(issue => issue.endsWith(t('filmStudio.useanexactlocationtagandversion')))).toBe(true);
    await press(t('filmWorkspace.fillDefaults'));
    expect(has(t('filmWorkspace.defaultsRemaining', { value1: 1 }))).toBe(true);
});
test('Fill sensible defaults reuses a real location and preserves missing validation without a real beat', () => {
    const film = ready(); film.script = '';
    film.assets.push({ tag: '@room', version: 1, type: 'location', descriptor: '', references: [], tests: {} });
    const first = newShot(film); first.location = '@room:v1';
    film.shots = [first]; const second = newShot(film); film.shots.push(second);
    const result = fillShotDefaults(film, 1);
    expect(result.film.shots[1].location).toBe('@room:v1');
    expect(result.film.shots[1].description).toBe('');
    expect(result.film.shots[1].goal).toBe('');
    expect(result.film.shots[1].oneAction).toBe(false);
});
test('Fill sensible defaults does not copy an invalid location value', () => {
    const film = ready(); const first = newShot(film); first.location = 'kitchen';
    film.shots = [first]; const second = newShot(film); film.shots.push(second);
    const result = fillShotDefaults(film, 1);
    expect(result.film.shots[1].location).toBe('');
    expect(result.remaining).toBeGreaterThan(0);
});
test('Fill sensible defaults selects the script beat at the shot position', () => {
    const film = ready(); film.script = 'Maya wakes.\nShe pours coffee.';
    film.shots = [newShot(film)]; film.shots.push(newShot(film));
    const first = fillShotDefaults(film, 0), second = fillShotDefaults(film, 1);
    expect(first.film.shots[0].description).toBe('Maya wakes.');
    expect(second.film.shots[1].description).toBe('She pours coffee.');
});
test('script beats preserve abbreviations and decimals while excluding screenplay headings', () => {
    expect(scriptBeats('INT. KITCHEN - DAY\nMAYA\n(quietly)\nGood morning.\nMaya crosses the room.\nCUT TO:\nDr. Reyes walks 3.5 metres.\n第三段。\nمشهد هادئ.\nदृश्य शांत है।'))
        .toEqual(['Maya crosses the room.', 'Dr. Reyes walks 3.5 metres.', '第三段。', 'مشهد هادئ.', 'दृश्य शांत है।']);
});
