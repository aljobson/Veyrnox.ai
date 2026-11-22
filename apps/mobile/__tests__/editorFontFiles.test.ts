import { webcrypto as mockWebcrypto } from 'node:crypto';
import { createEditorFontStore, fontMetadata, NATIVE_FONT_LIMIT } from '../src/lib/editorFontFiles';
import type { CacheStorage } from '../src/lib/cache';

const mockFiles = new Map<string, Uint8Array>(), mockDirectories = new Set<string>();
let mockDigestGate: Promise<void> | null = null, mockDigestStarted: (() => void) | null = null;
jest.mock('expo-file-system', () => {
    const uri = (...parts: unknown[]) => {
        const values = parts.map(part => typeof part === 'string' ? part : (part as { uri: string }).uri);
        return values.length < 2 ? values[0] : [values[0].replace(/\/+$/, ''), ...values.slice(1).map(value => value.replace(/^\/+|\/+$/g, ''))].join('/');
    };
    class File {
        uri: string; name: string;
        constructor(...parts: unknown[]) { this.uri = uri(...parts); this.name = this.uri.split('/').at(-1)!; }
        get exists() { return mockFiles.has(this.uri); } get size() { return mockFiles.get(this.uri)?.byteLength ?? 0; }
        async bytes() { return mockFiles.get(this.uri) ?? new Uint8Array(); }
        async copy(target: File, options?: { overwrite?: boolean }) { if (target.exists && !options?.overwrite) throw Error('exists'); mockFiles.set(target.uri, new Uint8Array(await this.bytes())); }
        async move(target: File, options?: { overwrite?: boolean }) { await this.copy(target, options); this.delete(); }
        delete() { mockFiles.delete(this.uri); }
    }
    class Directory {
        uri: string; name: string;
        constructor(...parts: unknown[]) { this.uri = uri(...parts); this.name = this.uri.split('/').at(-1)!; }
        get exists() { return mockDirectories.has(this.uri) || [...mockFiles.keys()].some(path => path.startsWith(this.uri + '/')); }
        create() { mockDirectories.add(this.uri); }
        list() {
            const names = new Set([...mockFiles.keys(), ...mockDirectories].filter(path => path.startsWith(this.uri + '/')).map(path => path.slice(this.uri.length + 1).split('/')[0]).filter(Boolean));
            return [...names].map(name => mockFiles.has(`${this.uri}/${name}`) ? new File(this, name) : new Directory(this, name));
        }
        delete() { for (const path of [...mockFiles.keys()]) if (path === this.uri || path.startsWith(this.uri + '/')) mockFiles.delete(path);
            for (const path of [...mockDirectories]) if (path === this.uri || path.startsWith(this.uri + '/')) mockDirectories.delete(path); }
    }
    return { File, Directory, Paths: { document: { uri: 'file:///documents' } } };
});
jest.mock('expo-font', () => ({ loadAsync: jest.fn(), unloadAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_: string, data: BufferSource) => {
        const gate = mockDigestGate, started = mockDigestStarted; mockDigestGate = null; mockDigestStarted = null; started?.(); if (gate) await gate;
        return mockWebcrypto.subtle.digest('SHA-256', data as Parameters<typeof mockWebcrypto.subtle.digest>[1]);
    },
}));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => null, subscribeCacheUser: () => () => {} }));

const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', project = '33333333-3333-4333-8333-333333333333';
const otherProject = '44444444-4444-4444-8444-444444444444';
const ttf = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const rights = { credit: 'Creator', usage: 'Licensed for this project', url: 'https://example.test/licence' };

beforeEach(() => { mockFiles.clear(); mockDirectories.clear(); mockDigestGate = null; mockDigestStarted = null; jest.clearAllMocks(); });
test('font metadata is content-addressed from its signature and enforces file and rights bounds', async () => {
    const result = await fontMetadata(ttf, 'owned.ttf', { name: 'Owned', rights });
    expect(result).toMatchObject({ font: { name: 'Owned', sourceName: 'owned.ttf', bytes: 12, format: 'ttf', rights } });
    if ('font' in result) expect(result.font.family).toBe('VXFont_' + result.font.sha256);
    expect(await fontMetadata(new Uint8Array(11), 'short.ttf', { name: 'Short', rights })).toEqual({ problem: 'invalidFile' });
    expect(await fontMetadata(new Uint8Array(NATIVE_FONT_LIMIT + 1), 'large.ttf', { name: 'Large', rights })).toEqual({ problem: 'invalidFile' });
    expect(await fontMetadata(new Uint8Array(12), 'fake.ttf', { name: 'Fake', rights })).toEqual({ problem: 'unsupportedFormat' });
    expect(await fontMetadata(ttf, 'owned.ttf', { name: 'Owned', rights: { ...rights, url: 'http://example.test' } })).toEqual({ problem: 'invalidMetadata' });
});
test('install persists verified bytes, relink rejects a different original, and account changes unload and erase', async () => {
    const load = jest.fn(async () => {}), unload = jest.fn(async () => {}), store = createEditorFontStore(load, unload);
    await store.setOwner(owner); await store.setProject(project); mockFiles.set('file:///pick/owned.ttf', ttf);
    const installed = await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    expect('font' in installed).toBe(true); if (!('font' in installed)) return;
    expect(store.has(project, installed.font.family)).toBe(true); expect(load).toHaveBeenCalledWith(installed.font.family, expect.stringContaining('/' + owner + '/' + project + '/'));
    mockFiles.set('file:///pick/different.ttf', new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]));
    expect(await store.install(project, { uri: 'file:///pick/different.ttf', name: 'different.ttf', size: 12 }, { name: 'Owned', rights }, installed.font)).toEqual({ problem: 'originalMismatch' });
    await store.setOwner(other);
    expect(store.has(project, installed.font.family)).toBe(false); expect(unload).toHaveBeenCalledWith(installed.font.family);
    expect([...mockFiles.keys()].some(path => path.includes('/' + owner + '/'))).toBe(false);
});
test('a new registry rehashes and restores a durable owner-scoped font', async () => {
    const first = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await first.setOwner(owner); await first.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf);
    const installed = await first.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    const load = jest.fn(async () => {}), restored = createEditorFontStore(load, jest.fn(async () => {})); await restored.setOwner(owner); await restored.setProject(project);
    await restored.hydrate(project, [installed.font]);
    expect(restored.has(project, installed.font.family)).toBe(true); expect(load).toHaveBeenCalledTimes(1);
});
test('an unknown owner never deletes durable font folders during cold start or session expiry', async () => {
    mockDirectories.add(`file:///documents/veyrnox-editor-fonts/${owner}/${project}`);
    mockFiles.set(`file:///documents/veyrnox-editor-fonts/${owner}/${project}/font.ttf`, ttf);
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {}));
    await store.setOwner(null); await store.setOwner(owner); await store.setOwner(null);
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`))).toBe(true);
    await store.setOwner(owner); await store.setOwner(null, true);
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`))).toBe(false);
});
test('a failed first load removes the newly persisted orphan', async () => {
    const store = createEditorFontStore(jest.fn(async () => { throw Error('unsupported'); }), jest.fn(async () => {}));
    await store.setOwner(owner); await store.setProject(project); mockFiles.set('file:///pick/owned.ttf', ttf);
    expect(await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights })).toEqual({ problem: 'loadFailed' });
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`) && !path.endsWith('.pending'))).toBe(false);
});
test('simultaneous same-project installs publish once and share one registered face', async () => {
    const load = jest.fn(async () => {}), store = createEditorFontStore(load, jest.fn(async () => {})); await store.setOwner(owner); await store.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf);
    const picked = { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 };
    const results = await Promise.all([store.install(project, picked, { name: 'Owned', rights }), store.install(project, picked, { name: 'Owned', rights })]);
    expect(results.every(result => 'font' in result)).toBe(true);
    expect(results.filter(result => 'font' in result && result.created)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
});
test('a stale sign-out purge cannot erase the newly authenticated owner directory', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(() => pending)); await store.setOwner(owner); await store.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    mockDirectories.add(`file:///documents/veyrnox-editor-fonts/${other}/${otherProject}`);
    mockFiles.set(`file:///documents/veyrnox-editor-fonts/${other}/${otherProject}/keep.ttf`, ttf);
    const stale = store.setOwner(null, true), current = store.setOwner(other); release(); await Promise.all([stale, current]);
    expect(mockFiles.has(`file:///documents/veyrnox-editor-fonts/${other}/${otherProject}/keep.ttf`)).toBe(true);
});
test('a project switch invalidates an in-flight load and never reports the next project ready', async () => {
    let release!: () => void, started!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const loadStarted = new Promise<void>(resolve => { started = resolve; });
    let calls = 0; const load = jest.fn(() => { if (calls++ === 0) { started(); return pending; } return Promise.resolve(); });
    const unload = jest.fn(async () => {}), store = createEditorFontStore(load, unload);
    await store.setOwner(owner); await store.setProject(project); mockFiles.set('file:///pick/owned.ttf', ttf);
    const installing = store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    await loadStarted; expect(load).toHaveBeenCalledTimes(1); await store.setProject(otherProject); await store.releaseProject(project);
    const next = store.install(otherProject, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights }); release();
    const [result, second] = await Promise.all([installing, next]);
    expect(result).toEqual({ problem: 'accountChanged' }); expect('font' in second).toBe(true); if (!('font' in second)) return;
    expect(store.has(otherProject, second.font.family)).toBe(true); expect(load).toHaveBeenCalledTimes(2); expect(unload).toHaveBeenCalledTimes(1);
});
test('project cleanup erases only that project font directory', async () => {
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await store.setOwner(owner); await store.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const first = await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in first)) throw Error(first.problem);
    await store.setProject(otherProject); await store.install(otherProject, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    await store.removeProjectFonts(project);
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`))).toBe(false);
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${otherProject}/`))).toBe(true);
});
test('owner binding finishes a crash-left project deletion tombstone', async () => {
    const records = new Map<string, string>(), storage: CacheStorage = {
        get: async key => records.get(key) ?? null, set: async (key, value) => { records.set(key, value); }, remove: async key => { records.delete(key); },
        keys: async () => [...records.keys()],
    };
    const key = `editor-font-delete.${owner}.${project}`; records.set(key, JSON.stringify({ owner, projectId: project }));
    mockDirectories.add(`file:///documents/veyrnox-editor-fonts/${owner}/${project}`);
    mockFiles.set(`file:///documents/veyrnox-editor-fonts/${owner}/${project}/font.ttf`, ttf);
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {}), storage); await store.setOwner(owner);
    expect(records.has(key)).toBe(false); expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`))).toBe(false);
});
test('removal unloads the project face but retains bytes so Undo can restore it', async () => {
    const unload = jest.fn(async () => {}), store = createEditorFontStore(jest.fn(async () => {}), unload); await store.setOwner(owner); await store.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const installed = await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem); await store.remove(project, installed.font);
    expect(store.has(project, installed.font.family)).toBe(false); expect(unload).toHaveBeenCalledWith(installed.font.family);
    expect([...mockFiles.keys()].some(path => path.includes(`/${owner}/${project}/`) && path.endsWith('.ttf'))).toBe(true);
});
test('hydrate exposes a verified face that this iPhone cannot load', async () => {
    const first = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await first.setOwner(owner); await first.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const installed = await first.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    const load = jest.fn(async () => { throw Error('unsupported'); }), restored = createEditorFontStore(load, jest.fn(async () => {}));
    await restored.setOwner(owner); await restored.setProject(project); let notifications = 0; const off = restored.subscribe(() => { notifications++; });
    await restored.hydrate(project, [installed.font]); await restored.hydrate(project, [installed.font]); off();
    expect(restored.failed(project, installed.font.family)).toBe(true); expect(restored.has(project, installed.font.family)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1); expect(notifications).toBe(1);
});
test('a published import survives immediate release, while a rejected document reconciliation removes it', async () => {
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await store.setOwner(owner); await store.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const installed = await store.install(project,
        { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    await store.releaseProject(project);
    expect([...mockFiles.keys()].some(path => path.endsWith(`/${installed.font.sha256}.ttf`))).toBe(true);

    await store.setProject(project); store.declare(project, []); await store.releaseProject(project);
    expect([...mockFiles.keys()].some(path => path.endsWith(`/${installed.font.sha256}.ttf`))).toBe(false);
});
test('a stale release cannot clean a replacement generation that already opened and closed', async () => {
    let releaseUnload!: () => void, markStarted!: () => void;
    const unloadGate = new Promise<void>(resolve => { releaseUnload = resolve; }), unloadStarted = new Promise<void>(resolve => { markStarted = resolve; });
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(() => { markStarted(); return unloadGate; }));
    await store.setOwner(owner); await store.setProject(project); mockFiles.set('file:///pick/owned.ttf', ttf);
    const installed = await store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    const releasing = store.releaseProject(project); await unloadStarted; await store.setProject(project);
    const replacementBytes = new Uint8Array([0, 1, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]);
    const replacementMeta = await fontMetadata(replacementBytes, 'replacement.ttf', { name: 'Replacement', rights });
    if (!('font' in replacementMeta)) throw Error(replacementMeta.problem);
    store.declare(project, [replacementMeta.font]);
    const replacement = `file:///documents/veyrnox-editor-fonts/${owner}/${project}/${replacementMeta.font.sha256}.ttf`;
    mockDirectories.add(`file:///documents/veyrnox-editor-fonts/${owner}/${project}`); mockFiles.set(replacement, replacementBytes);
    await store.releaseProject(project);
    releaseUnload(); await releasing;
    expect(mockFiles.has(replacement)).toBe(true);
});
test('hydrate cannot erase a valid relink that replaces corrupt bytes during verification', async () => {
    const seed = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await seed.setOwner(owner); await seed.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const installed = await seed.install(project,
        { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    const target = `file:///documents/veyrnox-editor-fonts/${owner}/${project}/${installed.font.sha256}.ttf`;
    mockFiles.set(target, new Uint8Array([0, 1, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0]));
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await store.setOwner(owner); await store.setProject(project);
    let releaseDigest!: () => void, markStarted!: () => void;
    mockDigestGate = new Promise<void>(resolve => { releaseDigest = resolve; }); const digestStarted = new Promise<void>(resolve => { markStarted = resolve; });
    mockDigestStarted = markStarted; const hydrating = store.hydrate(project, [installed.font]); await digestStarted;
    const relinking = store.install(project, { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights }, installed.font);
    releaseDigest(); const [, result] = await Promise.all([hydrating, relinking]);
    expect('font' in result).toBe(true); expect(mockFiles.get(target)).toEqual(ttf); expect(store.has(project, installed.font.family)).toBe(true);
});
test('remove wins over an older in-flight hydrate and cannot resurrect the face', async () => {
    const seed = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await seed.setOwner(owner); await seed.setProject(project);
    mockFiles.set('file:///pick/owned.ttf', ttf); const installed = await seed.install(project,
        { uri: 'file:///pick/owned.ttf', name: 'owned.ttf', size: 12 }, { name: 'Owned', rights });
    if (!('font' in installed)) throw Error(installed.problem);
    const store = createEditorFontStore(jest.fn(async () => {}), jest.fn(async () => {})); await store.setOwner(owner); await store.setProject(project);
    let releaseDigest!: () => void, markStarted!: () => void;
    mockDigestGate = new Promise<void>(resolve => { releaseDigest = resolve; }); const digestStarted = new Promise<void>(resolve => { markStarted = resolve; });
    mockDigestStarted = markStarted; const hydrating = store.hydrate(project, [installed.font]); await digestStarted;
    const removing = store.remove(project, installed.font); releaseDigest(); await Promise.all([hydrating, removing]);
    expect(store.has(project, installed.font.family)).toBe(false);
});
