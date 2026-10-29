import { act, StrictMode } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/brand-kit';
import { BrandKitEditor } from '../src/components/brand/BrandKitEditor';
import { ApiError } from '../src/lib/api';
import { emptyKit, type Kit, type KitAsset } from '../src/lib/brandKit';
import { TEXT_DEFAULTS } from '../src/lib/brandKitStyles';
import { t } from '../src/lib/i18n';
const mockRequest = jest.fn(), mockPut = jest.fn(), mockPhotos = jest.fn(), mockFiles = jest.fn();
let mockCurrent = true;
const mockTask = { gen: 1, user: 'u', current: () => mockCurrent };
const mockBegin = jest.fn(() => mockTask), mockApi = { request: mockRequest };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: mockBegin }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockPhotos(...args), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockFiles(...args) }));
jest.mock('../src/lib/uploads', () => ({ putFromDisk: (...args: unknown[]) => mockPut(...args) }));
void [RN.ScrollView, RN.Text, RN.TextInput, RN.Pressable, RN.StyleSheet, RN.View];
const WS = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const asset = (n: number): KitAsset => ({ projectId: WS, assetId: id(n), name: `Asset ${n}`, credit: '', usage: '', url: '' });
const catalogRow = (n: number) => ({ id: id(n), project_id: WS, sniffed_type: 'image/png', byte_size: 100 });
const style = { name: 'Headline', size: 6, style: { ...TEXT_DEFAULTS } };
const picked = { canceled: false, assets: [{ uri: 'file:///photo.png', mimeType: 'image/png', fileSize: 100, size: 100 }] };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let root: Root, kit: Kit, editable: boolean, catalog: ReturnType<typeof catalogRow>[], projectList: { id: string; name: string; workspace_id: string }[];
let heldRead: ReturnType<typeof deferred<unknown>> | null, heldSave: ReturnType<typeof deferred<unknown>> | null, saveError: unknown;
const readState = () => ({ kit, version: 1, canEdit: editable });
function buttons(label: string) { return root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label); }
function click(label: string) { const nodes = buttons(label); expect(nodes).toHaveLength(1); nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); }
async function press(label: string) { await act(async () => click(label)); }
function input(label: string) { return root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onChangeText)[0]; }
async function type(label: string, value: string) { expect(input(label)).toBeDefined(); await act(async () => input(label).props.onChangeText(value)); }
function has(text: string) { return root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0; }
const writes = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const saved = (): Kit => JSON.parse(writes().at(-1)?.[1].body).kit;
const reservations = () => mockRequest.mock.calls.filter(([path, init]) => path.endsWith('/assets') && init?.method === 'POST');
const inspect = () => mockRequest.mock.calls.filter(([path]) => path.endsWith('/inspect'));
const addLabel = () => t('brand.asset.addLabel', { name: t('brand.assetDefault', { type: 'image/png', id: id(90).slice(0, 8) }) });
async function mount() { root = createRoot(); await act(async () => root.render(<StrictMode><Screen /></StrictMode>)); }
async function save() { await press(t('brand.save')); }
async function switchSpace(name: string) {
    const tabs = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.children.some(c => typeof c === 'object' && c !== null && 'children' in c && (c.children as unknown[]).includes(name)));
    expect(tabs).toHaveLength(1); await act(async () => tabs[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockCurrent = true; kit = emptyKit(); editable = true; catalog = [catalogRow(90)];
    heldRead = null; heldSave = null; saveError = null; projectList = [{ id: WS, name: 'Project', workspace_id: WS }];
    mockPhotos.mockResolvedValue(picked); mockFiles.mockResolvedValue(picked); mockPut.mockResolvedValue(undefined);
    mockRequest.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === '/api/v1/workspaces') return { workspaces: [{ id: WS, name: 'Studio', is_default: true }, { id: OTHER, name: 'Client work' }] };
        if (path.includes('/projects?')) return { projects: projectList };
        if (path.endsWith('/brand-assets')) return { assets: catalog, truncated: false };
        if (path.endsWith('/brand-kit')) {
            if (init?.method === 'PUT') { if (saveError) throw saveError; return heldSave ? heldSave.promise : { ...readState(), kit: JSON.parse(String(init.body)).kit, version: 2 }; }
            if (path.includes(WS) && heldRead) return heldRead.promise;
            return path.includes(OTHER) ? { ...readState(), kit: { ...kit, name: 'Client brand' } } : readState();
        }
        if (path.endsWith('/inspect')) { catalog = [...catalog, catalogRow(99)]; return { state: 'inspected' }; }
        if (path.endsWith('/assets')) return { asset_id: id(99), upload_url: 'https://storage.example/file', content_type: 'image/png' };
        throw new Error(`Unexpected ${path}`);
    });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); });
test('an editor adds a text style and the save carries it', async () => {
    await mount(); await press(t('brand.style.add')); await type(t('brand.style.name'), 'Headline'); await press(t('brand.style.done')); await save();
    expect(saved().textStyles).toEqual([style]); expect(writes()[0][2]).toEqual({ task: mockTask });
});
test('an editor edits and removes a text style', async () => {
    kit = { ...kit, textStyles: [style] }; await mount(); await press(t('brand.style.editLabel', { name: 'Headline' }));
    await type(t('brand.style.size'), '12'); await press(t('brand.style.done')); await save(); expect(saved().textStyles).toEqual([{ ...style, size: 12 }]);
    await press(t('brand.style.removeLabel', { name: 'Headline' })); await save(); expect(saved().textStyles).toEqual([]);
});
test('a stored style the app cannot read can only be removed', async () => {
    kit = { ...kit, textStyles: [{ bad: true }] }; await mount(); expect(has(t('brand.style.unreadable'))).toBe(true);
    expect(buttons(t('brand.style.editLabel', { name: t('brand.style.unreadable') }))).toHaveLength(0);
    await press(t('brand.style.removeLabel', { name: t('brand.style.unreadable') })); await save(); expect(saved().textStyles).toEqual([]);
});
test('an editor attaches a workspace file, edits its credit and saves it', async () => {
    await mount(); await press(addLabel()); await type(t('brand.asset.field.credit', { number: 1 }), 'Artist'); await save();
    expect(saved().assets).toEqual([expect.objectContaining({ assetId: id(90), credit: 'Artist' })]);
    expect(saved().assets[0]).not.toHaveProperty('key');
});
test('removing an attached asset only detaches it', async () => {
    kit = { ...kit, assets: [asset(1)] }; await mount(); await press(t('brand.asset.removeLabel', { name: 'Asset 1' })); await save();
    expect(saved().assets).toEqual([]); expect(mockRequest.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
});
test('an uploaded file is attached after inspection and the catalog is re-read', async () => {
    await mount(); const before = mockRequest.mock.calls.filter(([p]) => p.endsWith('/brand-assets')).length;
    await press(t('brand.upload.photos')); expect(inspect()).toHaveLength(1); expect(has(t('brand.upload.done'))).toBe(true);
    expect(mockRequest.mock.calls.filter(([p]) => p.endsWith('/brand-assets'))).toHaveLength(before + 1);
    await save(); expect(saved().assets).toEqual([expect.objectContaining({ assetId: id(99), projectId: WS })]);
});
test('upload off hides the upload buttons and keeps attach', async () => {
    await mount(); mockRequest.mockRejectedValueOnce(new ApiError(404, 'unknown')); await press(t('brand.upload.files'));
    expect(has(t('brand.upload.err.off'))).toBe(true); expect(buttons(t('brand.upload.files'))).toHaveLength(0); expect(buttons(t('brand.upload.photos'))).toHaveLength(0); expect(buttons(addLabel())).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'radio')).toHaveLength(1);
    expect(has('Project')).toBe(true);
});
test('no project shows the create-a-project message', async () => { projectList = []; await mount(); expect(has(t('brand.upload.noProject'))).toBe(true); expect(buttons(t('brand.upload.photos'))).toHaveLength(0); });
test('a read-only kit shows styles and assets with no controls', async () => {
    editable = false; kit = { ...kit, assets: [asset(1)], textStyles: [style] }; await mount(); expect(has('Headline')).toBe(true); expect(has('Asset 1')).toBe(true);
    for (const label of [t('brand.save'), t('brand.style.add'), t('brand.upload.photos'), t('brand.asset.removeLabel', { name: 'Asset 1' })]) expect(buttons(label)).toHaveLength(0);
    expect(input(t('brand.asset.field.credit', { number: 1 })).props.editable).toBe(false);
});
test('a slow kit read for the previous workspace does not land', async () => {
    heldRead = deferred(); await mount(); await switchSpace('Client work'); expect(input(t('brand.name')).props.value).toBe('Client brand');
    await act(async () => heldRead!.resolve(readState())); expect(input(t('brand.name')).props.value).toBe('Client brand');
});
test('nothing from an old account lands after an account change', async () => {
    heldRead = deferred(); await mount(); mockCurrent = false; await act(async () => heldRead!.resolve(readState())); expect(input(t('brand.name'))).toBeUndefined();
    await act(async () => root.unmount()); mockCurrent = true; heldRead = null; heldSave = deferred(); await mount(); await save();
    mockCurrent = false; await act(async () => heldSave!.resolve({ ...readState(), version: 2 })); expect(has(t('brand.saved'))).toBe(false);
    await act(async () => root.unmount()); mockCurrent = true; heldSave = null; await mount(); expect(buttons(t('brand.save'))).toHaveLength(1);
});
test('a save that 404s says a file may be gone', async () => { saveError = new ApiError(404, 'unknown'); await mount(); await save(); expect(has(t('brand.err.saveNotFound'))).toBe(true); });
test.each(['account', 'unmount'])('an account change while the picker is open sends no upload request (%s)', async change => {
    const pick = deferred<typeof picked>(); mockPhotos.mockReturnValue(pick.promise); await mount(); await press(t('brand.upload.photos'));
    expect(mockBegin.mock.invocationCallOrder.at(-1)!).toBeLessThan(mockPhotos.mock.invocationCallOrder[0]);
    if (change === 'account') mockCurrent = false; else await act(async () => root.unmount());
    await act(async () => pick.resolve(picked)); expect(reservations()).toHaveLength(0); expect(mockPut).not.toHaveBeenCalled();
    if (change === 'account') expect(has(t('brand.upload.done'))).toBe(false);
});
test.each(['workspace', 'project'])('a workspace or project change while the picker is open sends no upload request (%s)', async change => {
    const pick = deferred<typeof picked>(); mockFiles.mockReturnValue(pick.promise);
    if (change === 'workspace') { await mount(); await press(t('brand.upload.files')); await switchSpace('Client work'); }
    else {
        root = createRoot(); const props = { workspaceId: WS, state: readState(), onSaved: jest.fn() };
        await act(async () => root.render(<BrandKitEditor {...props} projects={[{ id: WS, name: 'Project', workspaceId: WS, version: 0, createdAt: null, updatedAt: null }]} />));
        await press(t('brand.upload.files')); await act(async () => root.render(<BrandKitEditor {...props} projects={[]} />));
    }
    await act(async () => pick.resolve(picked)); expect(reservations()).toHaveLength(0); expect(mockPut).not.toHaveBeenCalled();
});
test('an account change during the upload attaches nothing', async () => {
    const put = deferred<void>(); mockPut.mockReturnValue(put.promise); await mount(); await press(t('brand.upload.photos')); mockCurrent = false;
    await act(async () => put.resolve()); expect(inspect()).toHaveLength(0); expect(has(t('brand.upload.done'))).toBe(false); expect(input(t('brand.asset.field.name', { number: 1 }))).toBeUndefined();
});
test('edits and removals made during an upload survive its completion', async () => {
    kit = { ...kit, assets: [asset(1), asset(2)] }; const put = deferred<void>(); mockPut.mockReturnValue(put.promise); await mount(); await press(t('brand.upload.photos'));
    await type(t('brand.asset.field.credit', { number: 1 }), 'New credit'); await press(t('brand.asset.removeLabel', { name: 'Asset 2' })); await press(addLabel());
    await act(async () => put.resolve()); await save(); expect(saved().assets).toEqual([expect.objectContaining({ assetId: id(1), credit: 'New credit' }), expect.objectContaining({ assetId: id(90) }), expect.objectContaining({ assetId: id(99) })]);
});
test('an upload that finishes when the kit is full is not attached and is offered from the workspace', async () => {
    kit = { ...kit, assets: Array.from({ length: 23 }, (_, i) => asset(i)) }; const put = deferred<void>(); mockPut.mockReturnValue(put.promise); await mount(); await press(t('brand.upload.files')); await press(addLabel());
    const reads = mockRequest.mock.calls.filter(([p]) => p.endsWith('/brand-assets')).length;
    await act(async () => put.resolve()); expect(has(t('brand.upload.full'))).toBe(true); expect(mockRequest.mock.calls.filter(([p]) => p.endsWith('/brand-assets'))).toHaveLength(reads + 1);
    await save(); expect(saved().assets).toHaveLength(24); expect(saved().assets).not.toContainEqual(expect.objectContaining({ assetId: id(99) }));
    await press(t('brand.asset.removeLabel', { name: 'Asset 0' })); await press(addLabel()); await save(); expect(saved().assets).toContainEqual(expect.objectContaining({ assetId: id(99) }));
});
test.each([22, 23])('upload completion reports its outcome while a draft update is still queued (%i)', async count => {
    kit = { ...kit, assets: Array.from({ length: count }, (_, i) => asset(i)) }; const put = deferred<void>(); mockPut.mockReturnValue(put.promise); await mount(); await press(t('brand.upload.photos'));
    await act(async () => { input(t('brand.asset.field.credit', { number: 1 })).props.onChangeText('Queued'); if (count === 23) click(addLabel()); put.resolve(); });
    expect(has(t(count === 22 ? 'brand.upload.done' : 'brand.upload.full'))).toBe(true); await save(); expect(saved().assets).toHaveLength(count === 22 ? 23 : 24);
    expect(saved().assets[0]).toMatchObject({ credit: 'Queued' }); expect(saved().assets.filter(a => (a as KitAsset).assetId === id(99))).toHaveLength(count === 22 ? 1 : 0);
});
test('two stored entries for one file are edited and removed separately', async () => {
    kit = { ...kit, assets: [{ ...asset(1), credit: 'x' }, { ...asset(1), credit: 'y' }, null, { foo: 1 }] }; await mount();
    await type(t('brand.asset.field.credit', { number: 2 }), 'z'); await press(t('brand.asset.removeLabel', { name: t('brand.asset.field.name', { number: 3 }) }));
    await save(); expect(writes()).toHaveLength(0); expect(has(t('brand.problem.assets'))).toBe(true);
    await press(t('brand.asset.removeLabel', { name: t('brand.asset.field.name', { number: 3 }) })); await save(); expect(saved().assets).toEqual([{ ...asset(1), credit: 'x' }, { ...asset(1), credit: 'z' }]);
});
test('selecting the current workspace keeps the editor visible', async () => {
    await mount(); await switchSpace('Studio'); expect(input(t('brand.name')).props.value).toBe(kit.name);
});
test('workspace A to B to A accepts only the final A read', async () => {
    const first = deferred<unknown>(), last = deferred<unknown>(); heldRead = first; await mount(); await switchSpace('Client work'); heldRead = last;
    await switchSpace('Studio'); await act(async () => last.resolve({ ...readState(), kit: { ...kit, name: 'Newest' } }));
    await act(async () => first.resolve({ ...readState(), kit: { ...kit, name: 'Old' } })); expect(input(t('brand.name')).props.value).toBe('Newest');
});

test('a 404 on one project does not stop uploads to another', async () => {
    projectList.push({ id: OTHER, name: 'Second project', workspace_id: WS });
    await mount(); mockRequest.mockRejectedValueOnce(new ApiError(404, 'unknown')); await press(t('brand.upload.files'));
    const chips = root.container.queryAll(n => n.props.accessibilityRole === 'radio');
    expect(chips).toHaveLength(2);
    await act(async () => chips[1].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    expect(has(t('brand.upload.err.off'))).toBe(false);
    await press(t('brand.upload.files'));
    expect(reservations()).toHaveLength(2);
    expect(reservations()[1][0]).toBe(`/api/v1/projects/${OTHER}/assets`);
    expect(inspect()).toHaveLength(1);
    expect(inspect()[0][0]).toBe(`/api/v1/projects/${OTHER}/assets/${id(99)}/inspect`);
    await save(); expect(saved().assets).toContainEqual(expect.objectContaining({ projectId: OTHER, assetId: id(99) }));
});
