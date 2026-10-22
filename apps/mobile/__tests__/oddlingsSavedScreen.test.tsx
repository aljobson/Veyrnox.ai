import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ProjectChooser } from '../src/components/oddlings/ProjectChooser';
import { createOddlingsProjects } from '../src/lib/oddlingsProjects';
import type { ApiClient } from '../src/lib/api';
import Saved from '../src/app/(app)/oddlings/saved';
import { bindCacheUser, resetCacheUser, userDocStorage } from '../src/lib/appCache';
import { createCache, type CacheStorage } from '../src/lib/cache';
import { oddlingsStore, switchLink } from '../src/lib/oddlingsAccountStore';
import { emptyDoc, toServerDocument } from '../src/lib/oddlingsDocument';
import { ApiError } from '../src/lib/api';
import { MIN_TARGET } from '../src/lib/a11y';
import { t } from '../src/lib/i18n';
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: () => `uuid-key-${++n}` }; });
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]) }));
jest.mock('../src/components/VeyMascot', () => ({ VEY_CLEARANCE: 0 }));
jest.mock('../src/lib/appCache', () => {
    const actual = jest.requireActual('../src/lib/appCache'), data = new Map<string, string>();
    return { ...actual, userDocStorage: { get: async (k: string) => data.get(k) ?? null,
        set: async (k: string, v: string) => { data.set(k, v); }, remove: async (k: string) => { data.delete(k); }, keys: async () => [...data.keys()] } };
});
const app: CacheStorage = { get: async () => null, set: async () => {}, remove: async () => {}, keys: async () => [] };
let root: Root, alert: jest.SpyInstance;
const text = (value: string) => root.container.queryAll(node => node.children.includes(value));
const buttons = (label: string) => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);
const click = async (label: string) => { await act(async () => buttons(label)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
async function render() { await act(async () => root.render(<Saved />)); }
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetCacheUser(); for (const key of await userDocStorage.keys()) await userDocStorage.remove(key);
    await bindCacheUser('A', createCache(app), app, userDocStorage);
    mockRequest.mockReset().mockImplementation(async (path: string) => {
        if (path === '/api/v1/workspaces') return { workspaces: [{ id: 'W', name: 'Workspace', is_default: true }] };
        if (path.startsWith('/api/v1/projects?')) return { projects: [{ id: 'P', name: 'Existing project' }] };
        return { revision: 0, document: toServerDocument('P', emptyDoc()) };
    });
    root = createRoot(); alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); });
test('cached list has the local-only label and sign-out accessibility hint', async () => {
    await oddlingsStore.save({ oddling_name: 'Pip' }, 1, 'X'); await render();
    expect(text('Pip')).toHaveLength(1); expect(text(t('oddlingsProjects.phoneOnly'))).toHaveLength(1);
    const row = buttons(t('oddlings.saved.edit', { name: 'Pip' }))[0];
    expect(row.props.accessibilityValue).toEqual({ text: t('oddlingsProjects.phoneOnly') });
    expect(row.props.accessibilityHint).toBe(t('oddlingsProjects.signOutHint'));
});
test.each([503, 404])('unavailable %i is quiet, has a live region and hides the chooser', async status => {
    await oddlingsStore.save({ oddling_name: 'Pip' }, 1, 'X');
    await oddlingsStore.mutate(r => switchLink(r, 'P', emptyDoc(), 0));
    mockRequest.mockRejectedValue(new ApiError(status, 'do_not_display_123'));
    await render(); const line = text(t('oddlingsProjects.unavailable'));
    expect(line).toHaveLength(1); expect(line[0].props.accessibilityLiveRegion).toBe('polite');
    expect(text(t('oddlingsProjects.choose'))).toHaveLength(0);
    expect(root.container.queryAll(node => node.children.some(c => typeof c === 'string' && /do_not_display|503|404/.test(c)))).toHaveLength(0);
});
test('delete confirmation queues a removal and keeps the draft', async () => {
    await oddlingsStore.save({ oddling_name: 'Pip' }, 1, 'X'); await oddlingsStore.draft({ oddling_name: 'Draft' }, 2); await render();
    await click(t('oddlings.saved.delete', { name: 'Pip' })); expect((await oddlingsStore.read())?.local.items).toHaveLength(1);
    await act(async () => { await alert.mock.calls[0][2][1].onPress(); });
    expect((await oddlingsStore.read())?.ops).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'remove', id: 'X' })]));
    expect((await oddlingsStore.read())?.local.draft?.picks.oddling_name).toBe('Draft');
});
test('chooser checks the kind on tap, displays other-work message and disables the row', async () => {
    await render(); expect(mockRequest.mock.calls.some(([p]) => p.endsWith('/document'))).toBe(false);
    mockRequest.mockResolvedValue({ revision: 1, document: { schema_version: 1 } });
    await click('Existing project'); expect(text(t('oddlingsProjects.other'))).toHaveLength(1);
    expect(buttons('Existing project')[0].props.accessibilityState.disabled).toBe(true);
});
test('new headings, statuses and buttons expose accessibility semantics and targets', async () => {
    await render();
    for (const label of [t('oddlings.saved.title'), t('oddlingsProjects.choose')]) expect(text(label)[0].props.accessibilityRole).toBe('header');
    for (const node of root.container.queryAll(n => n.props.accessibilityRole === 'button')) {
        const style = RN.StyleSheet.flatten(node.props.style);
        expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TARGET); expect(node.props.accessibilityLabel).toBeTruthy();
    }
    expect(text(t('oddlings.saved.empty'))[0].props.accessibilityLiveRegion).toBe('polite');
});
test('account switch removes cached names and chooser state', async () => {
    await oddlingsStore.save({ oddling_name: 'Private Pip' }, 1, 'X'); await render();
    expect(text('Private Pip')).toHaveLength(1);
    await act(async () => { resetCacheUser(); await bindCacheUser('B', createCache(app), app, userDocStorage); });
    expect(text('Private Pip')).toHaveLength(0); expect((await oddlingsStore.read())?.local.items ?? []).toEqual([]);
});
test('Start empty only changes recovery choice after confirmation', async () => {
    await oddlingsStore.mutate(r => ({ ...r, recoverable: { items: [{ id: 'X', savedAt: 1, name: 'Pip', picks: { oddling_name: 'Pip' }, motionId: '' }], draft: null, from: 'Gone', at: 1 } }));
    await render(); await click(t('oddlingsProjects.startEmpty'));
    expect(buttons(t('oddlingsProjects.startEmpty'))[0].props.accessibilityState.selected).toBe(false);
    expect((await oddlingsStore.read())?.recoverable?.items).toHaveLength(1);
    await act(async () => alert.mock.calls[0][2][1].onPress());
    expect((await oddlingsStore.read())?.recoverable).toBeUndefined();
    await click('Existing project'); expect((await oddlingsStore.read())?.recoverable).toBeUndefined();
});

test('chooser mount leaves creation replay to the Saved focus sync', async () => {
    await oddlingsStore.mutate(r => ({ ...r, pendingCreate: { nonce: 'nonce-key', key: 'create-key', workspaceId: 'W', name: 'Oddlings', linkGenAtIntent: 0, createdAt: Date.now() } }));
    const engine = createOddlingsProjects(mockApi as unknown as ApiClient);
    const sync = jest.spyOn(engine, 'syncNow').mockResolvedValue('local');
    const record = await oddlingsStore.read();
    await act(async () => root.render(<ProjectChooser api={mockApi as unknown as ApiClient} engine={engine} record={record} onResult={() => {}} />));
    expect(sync).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/projects?workspace_id=W');
});
test('workspace rows with identical names have unique keys and select by id', async () => {
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/workspaces'
        ? { workspaces: [{ id: 'W1', name: 'Same name', is_default: true }, { id: 'W2', name: 'Same name' }] }
        : { projects: [] });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await render();
        expect(buttons('Same name')).toHaveLength(2);
        expect(buttons('Same name').map(n => n.props.accessibilityState.selected)).toEqual([true, false]);
        await act(async () => buttons('Same name')[1].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(mockRequest).toHaveBeenCalledWith('/api/v1/projects?workspace_id=W2');
        expect(buttons('Same name').map(n => n.props.accessibilityState.selected)).toEqual([false, true]);
        expect(errors.mock.calls.filter(args => args.some(v => typeof v === 'string' && /same key/.test(v)))).toEqual([]);
    } finally { errors.mockRestore(); }
});
