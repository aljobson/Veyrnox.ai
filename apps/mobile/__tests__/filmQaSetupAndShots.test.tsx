import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/workspace';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import * as store from '../src/lib/filmStudioStore';
import { emptyFilm, FILM_STAGES, type Film } from '../src/lib/filmStudio';
import { newShot, setupModels, setupPrice, shotNeeds } from '../src/lib/filmStudioOptions';
import type { CatalogModel } from '../src/lib/media';
import { plural, t } from '../src/lib/i18n';
const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockFetch = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter,
    useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
    usePreventRemove: () => () => {} }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: jest.fn() } }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: (...args: unknown[]) => mockFetch(...args) }));
void [RN.View, RN.Text, RN.TextInput, RN.ScrollView, RN.Pressable, RN.Modal, RN.FlatList, RN.StyleSheet];
const model = (id: string, modality: string, over: Partial<CatalogModel> = {}): CatalogModel => ({ id, name: `Name ${id}`, modality, credits: 4, gated: false, durations: [10, 15], capabilities: { inputs: { prompt: { max: 4000 } } }, ...over });
const needsFile = { inputs: { prompt: { max: 4000 } }, media: { image: { required: true, maxFiles: 1 } } };
const image = model('image', 'text-to-image', { credits: 3, durations: [] });
const video = model('video', 'text-to-video', { credits: 20 });
const edit = model('edit', 'image-to-image', { credits: 3, durations: [], capabilities: needsFile });
const reference = model('seedance-2.0-reference', 'image-to-video', { credits: 85, capabilities: needsFile });
const optionalFile = model('optional', 'text-to-video', { credits: 9, capabilities: { inputs: { prompt: { max: 4000 } }, media: { image: { required: false } } } });
const catalog = [image, video, edit, reference, optionalFile];
let root: Root;
const textOf = (node: any): string => node.children.map((c: any) => typeof c === 'string' ? c : textOf(c)).join('');
const has = (text: string) => textOf(root.container).includes(text);
const controls = (role: string) => root.container.queryAll(n => n.props.accessibilityRole === role);
const button = (label: string) => controls('button').find(n => n.props.accessibilityLabel === label || textOf(n) === label)!;
const click = async (node: any) => { expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
const press = async (label: string) => click(button(label));
async function open(label: string) { await click(controls('button').find(n => String(n.props.accessibilityLabel ?? '').startsWith(`${label}, `))); }
async function stage(index: number) { await click(controls('tab').find(n => n.props.accessibilityLabel === FILM_STAGES[index][1])); }
async function mount(film: Film) { await store.saveStudio(JSON.stringify(film)); root = createRoot(); await act(async () => root.render(<Screen />)); }
function ready(): Film { const film = emptyFilm(); film.name = 'Film'; film.script = 'Script'; film.stack.image = 'image'; film.stack.video = 'video'; return film; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks(); resetCacheUser(); await wipeCache(); await bindCacheUser('alice');
    mockFetch.mockResolvedValue({ value: catalog });
    jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });

test('models that need a source file (edit tools, the Seedance reference model) are not offered for a prompt-only film', () => {
    expect(setupModels(catalog, 'image').map(m => m.id)).toEqual(['image']);
    expect(setupModels(catalog, 'video').map(m => m.id)).toEqual(['video', 'optional']);
});
test('setup prices come from the catalog helper: the shortest film clip for video, one image for image', () => {
    expect(setupPrice(image, 'image')).toBe(3);
    expect(setupPrice(video, 'video')).toBe(40);
    expect(setupPrice(model('x', 'text-to-video', { credits: 5, durations: [5, 12, 15] }), 'video')).toBe(15);
});
test('a new shot still needs exactly the location tag and the one-action tick', () => {
    const film = ready(); const shot = newShot(film);
    expect(shotNeeds(shot)).toEqual(['location', 'oneAction']);
    expect(shotNeeds({ ...shot, location: '@room:v1' })).toEqual(['oneAction']);
    expect(shotNeeds({ ...shot, location: '@room:v1', oneAction: true })).toEqual([]);
});
test('setup model pickers list prices and hide edit-only and reference models', async () => {
    await mount(ready());
    await open(t('film.imagemodel'));
    expect(has(`Name image · ${plural('create.from', 3)}`)).toBe(true);
    expect(has('Name edit')).toBe(false);
    await press(t('oddlings.build.done'));
    await open(t('film.videomodel'));
    expect(has(`Name video · ${plural('create.from', 40)}`)).toBe(true);
    expect(has('Name optional')).toBe(true);
    expect(has('seedance-2.0-reference')).toBe(false);
    expect(has('Name seedance')).toBe(false);
});
test('clip length explains why only 10 to 15 seconds are offered', async () => {
    await mount(ready());
    expect(has(t('filmWorkspace.clipLengthWhy'))).toBe(true);
});
test('the shot list uses a friendly name; the raw id stays in its own field', async () => {
    const film = ready(); film.shots = [newShot(film)];
    await mount(film); await stage(2);
    const picker = controls('button').find(n => String(n.props.accessibilityLabel ?? '').startsWith(`${t('filmWorkspace.shotCards')}, `))!;
    expect(picker.props.accessibilityLabel).toBe(`${t('filmWorkspace.shotCards')}, ${t('filmWorkspace.shotLabel', { value1: 1 })}`);
    expect(picker.props.accessibilityLabel).not.toContain('sc01-sh01');
});
test('a new shot lists what is still to fill in plain words, and each row jumps to its field', async () => {
    await mount(ready()); await stage(2); await press(t('film.addshot'));
    expect(has(t('filmWorkspace.stillToFill'))).toBe(true);
    const location = button(t('filmWorkspace.needLocation')), tick = button(t('filmWorkspace.needOneAction'));
    expect(location).toBeDefined(); expect(tick).toBeDefined();
    await click(location);
    await click(tick);
    expect(has(t('filmWorkspace.stillToFill'))).toBe(true);
    await click(controls('checkbox').find(n => n.props.accessibilityLabel === t('filmWorkspace.oneAction')));
    expect(controls('button').some(n => n.props.accessibilityLabel === t('filmWorkspace.needOneAction'))).toBe(false);
    expect(controls('button').some(n => n.props.accessibilityLabel === t('filmWorkspace.needLocation'))).toBe(true);
});
