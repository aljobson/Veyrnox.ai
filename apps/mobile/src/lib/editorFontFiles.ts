import * as Crypto from 'expo-crypto';
import * as Font from 'expo-font';
import { Directory, File, Paths } from 'expo-file-system';
import { fontFormat } from '../../../../app/veyrnox/_lib/editorCustomFonts.mjs';
import { customFontFamily, fontMetadataProblem } from '../../../../app/veyrnox/_lib/editorOrganization.mjs';
import { getCacheUser, subscribeCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { UUID } from './editorServerExportStore';
import type { CustomFont } from './nativeEditorModel';

export const NATIVE_FONT_LIMIT = 2 * 1024 * 1024;
export type FontRights = CustomFont['rights'];
export type PickedFont = { uri: string; name: string; size?: number | null };
export type FontDraft = { name: string; rights: FontRights };
export type FontFileProblem = 'invalidFile' | 'unsupportedFormat' | 'invalidMetadata' | 'originalMismatch' | 'loadFailed' | 'accountChanged';
export type FontFileResult = { font: CustomFont; created: boolean } | { problem: FontFileProblem };
type FontMetadataResult = { font: CustomFont } | { problem: FontFileProblem };

const root = () => new Directory(Paths.document, 'veyrnox-editor-fonts');
const erase = (entry: Directory | File) => { if (entry.exists) entry.delete(); };
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
const destination = (owner: string, projectId: string, font: CustomFont) => new File(root(), owner, projectId, `${font.sha256}.${font.format}`);

export async function fontMetadata(bytes: Uint8Array, sourceName: string, draft: FontDraft): Promise<FontMetadataResult> {
    if (bytes.byteLength < 12 || bytes.byteLength > NATIVE_FONT_LIMIT) return { problem: 'invalidFile' };
    const format = fontFormat(bytes); if (!format) return { problem: 'unsupportedFormat' };
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const sha256 = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data));
    const font: CustomFont = { family: customFontFamily(sha256), name: draft.name.trim() || sourceName.replace(/\.[^.]+$/, '').slice(0, 80), sourceName,
        sha256, bytes: bytes.byteLength, format: format as CustomFont['format'], rights: draft.rights };
    return fontMetadataProblem(font) ? { problem: 'invalidMetadata' } : { font };
}

const TOMB = 'editor-font-delete.';
type ProjectRecord = { refs: number; families: Set<string>; failed: Set<string>; declared: Set<string>; revision: number; generation: number };
export function createEditorFontStore(load: typeof Font.loadAsync = Font.loadAsync, unload: typeof Font.unloadAsync = Font.unloadAsync,
    storage: CacheStorage | null = userDocStorage ?? null) {
    let owner: string | null = null, epoch = 0, initialized = false, temporarySequence = 0, ownerTransition: Promise<void> = Promise.resolve();
    const loaded = new Set<string>(), projects = new Map<string, ProjectRecord>(), generations = new Map<string, number>();
    const queues = new Map<string, Promise<unknown>>();
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach(listener => listener());
    const current = (token: number, expectedOwner: string, projectId: string, record: ProjectRecord) => token === epoch && owner === expectedOwner && projects.get(projectId) === record;
    const claimed = (family: string) => [...projects.values()].some(record => record.families.has(family));
    const enqueue = <T,>(family: string, work: () => Promise<T>) => {
        const result = (queues.get(family) ?? Promise.resolve()).catch(() => undefined).then(work);
        queues.set(family, result); const done = () => { if (queues.get(family) === result) queues.delete(family); }; result.then(done, done); return result;
    };
    const folder = (user: string, projectId: string) => {
        if (!UUID.test(user) || !UUID.test(projectId)) throw new Error('invalid_id');
        return new Directory(root(), user, projectId);
    };
    async function clearLoaded(emit = true) {
        const families = [...loaded]; loaded.clear(); for (const record of projects.values()) {
            record.revision++; record.families.clear(); record.failed.clear(); record.declared.clear();
        }
        await Promise.all(families.map(family => enqueue(family, () => unload(family).catch(() => undefined))));
        if (emit) notify();
    }
    function setOwner(next: string | null, purge = false) {
        if (initialized && next === owner && !purge) return;
        initialized = true;
        const token = ++epoch; owner = next;
        const run = ownerTransition.catch(() => undefined).then(async () => {
            if (token !== epoch) return; await clearLoaded(false); if (token !== epoch) return;
            if (root().exists && (next || purge)) for (const child of root().list()) if (child.name !== next) erase(child);
            if (token !== epoch) return;
            if (next && root().exists) {
                const ownerDir = new Directory(root(), next);
                if (ownerDir.exists) for (const project of ownerDir.list()) if (project instanceof Directory) for (const entry of project.list()) if (entry.name.endsWith('.pending')) erase(entry);
            }
            if (storage && (next || purge)) for (const key of await storage.keys()) {
                if (token !== epoch) return; if (!key.startsWith(TOMB)) continue;
                let value: { owner?: string; projectId?: string } | null = null;
                try { value = JSON.parse(await storage.get(key) || 'null'); } catch { /* Invalid tombstones are discarded below. */ }
                if (!next || value?.owner !== next || !value.projectId || !UUID.test(value.projectId)) { await storage.remove(key); continue; }
                erase(folder(next, value.projectId)); await storage.remove(key);
            }
            if (token === epoch) notify();
        });
        ownerTransition = run.catch(() => undefined); return run;
    }
    async function setProject(projectId: string) {
        if (!UUID.test(projectId)) throw new Error('invalid_id');
        const record = projects.get(projectId); if (record) { record.refs++; return; }
        const generation = (generations.get(projectId) ?? 0) + 1; generations.set(projectId, generation);
        projects.set(projectId, { refs: 1, families: new Set(), failed: new Set(), declared: new Set(), revision: 0, generation }); notify();
    }
    async function releaseProject(projectId: string) {
        const record = projects.get(projectId), user = owner, token = epoch; if (!record) return; if (--record.refs > 0) return;
        projects.delete(projectId); record.revision++; notify();
        await Promise.all([...record.families].map(family => enqueue(family, async () => {
            if (!claimed(family) && loaded.delete(family)) await unload(family).catch(() => undefined);
        })));
        if (user && token === epoch && owner === user && generations.get(projectId) === record.generation && !projects.has(projectId)) {
            const dir = folder(user, projectId); if (dir.exists) for (const entry of dir.list()) {
                if (entry.name.endsWith('.pending') || entry instanceof File && !record.declared.has(entry.name)) erase(entry);
            }
        }
    }
    const names = (fonts: readonly CustomFont[]) => new Set(fonts.map(font => `${font.sha256}.${font.format}`));
    function declare(projectId: string, fonts: readonly CustomFont[]) {
        const record = projects.get(projectId); if (!record) return;
        record.revision++; record.declared = names(fonts);
        const families = new Set(fonts.map(font => font.family));
        for (const family of record.failed) if (!families.has(family)) record.failed.delete(family);
    }
    async function verifiedBytes(picked: PickedFont) {
        const file = new File(picked.uri), size = picked.size ?? file.size;
        if (!file.exists || !Number.isSafeInteger(size) || size < 12 || size > NATIVE_FONT_LIMIT) return null;
        const bytes = await file.bytes(); return bytes.byteLength === size ? bytes : null;
    }
    async function persistAndLoad(user: string, projectId: string, record: ProjectRecord, token: number, font: CustomFont, picked: PickedFont): Promise<FontFileResult> {
        if (!current(token, user, projectId, record)) return { problem: 'accountChanged' };
        const dir = folder(user, projectId); dir.create({ intermediates: true, idempotent: true });
        const target = destination(user, projectId, font), temporary = new File(dir, `${font.sha256}.${++temporarySequence}.pending`);
        let created = false;
        try {
            await new File(picked.uri).copy(temporary, { overwrite: true });
            if (!current(token, user, projectId, record)) { erase(temporary); return { problem: 'accountChanged' }; }
            const accepted = await enqueue(font.family, async () => {
                if (!current(token, user, projectId, record)) { erase(temporary); return false; }
                const targetExisted = target.exists; await temporary.move(target, { overwrite: true }); created = !targetExisted;
                if (!loaded.has(font.family)) await load(font.family, target.uri);
                if (!current(token, user, projectId, record)) { if (!claimed(font.family)) await unload(font.family).catch(() => undefined); return false; }
                loaded.add(font.family); record.families.add(font.family); record.failed.delete(font.family);
                record.declared.add(`${font.sha256}.${font.format}`); record.revision++; notify(); return true;
            });
            if (!accepted) { if (created) erase(target); return { problem: 'accountChanged' }; }
            return { font, created };
        } catch { erase(temporary); if (created) erase(target); return { problem: 'loadFailed' }; }
    }
    async function install(projectId: string, picked: PickedFont, draft: FontDraft, declared?: CustomFont): Promise<FontFileResult> {
        const user = owner, token = epoch, record = projects.get(projectId); if (!user || !record) return { problem: 'accountChanged' };
        try {
            const bytes = await verifiedBytes(picked); if (!bytes || !current(token, user, projectId, record)) return { problem: bytes ? 'accountChanged' : 'invalidFile' };
            const result = await fontMetadata(bytes, picked.name, declared ? { name: declared.name, rights: declared.rights } : draft);
            if ('problem' in result) return result;
            if (declared && (result.font.sha256 !== declared.sha256 || result.font.bytes !== declared.bytes || result.font.format !== declared.format)) return { problem: 'originalMismatch' };
            return persistAndLoad(user, projectId, record, token, declared ?? result.font, picked);
        } catch { return { problem: current(token, user, projectId, record) ? 'invalidFile' : 'accountChanged' }; }
    }
    async function hydrate(projectId: string, fonts: readonly CustomFont[]) {
        const user = owner, token = epoch, record = projects.get(projectId); if (!user || !record || !UUID.test(projectId)) return;
        declare(projectId, fonts); const revision = record.revision;
        for (const font of fonts) {
            const fileName = `${font.sha256}.${font.format}`;
            if (!current(token, user, projectId, record) || record.revision !== revision || record.families.has(font.family)
                || record.failed.has(font.family) || fontMetadataProblem(font)) continue;
            await enqueue(font.family, async () => {
                const valid = () => current(token, user, projectId, record) && record.revision === revision && record.declared.has(fileName);
                if (!valid() || record.families.has(font.family) || record.failed.has(font.family)) return;
                const file = destination(user, projectId, font);
                try {
                    if (!file.exists || file.size !== font.bytes) return;
                    const bytes = await file.bytes(); if (!valid()) return;
                    const digest = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)); if (!valid()) return;
                    if (bytes.byteLength !== font.bytes || digest !== font.sha256) { erase(file); return; }
                    if (!loaded.has(font.family)) await load(font.family, file.uri);
                    if (!valid()) { if (!claimed(font.family)) await unload(font.family).catch(() => undefined); return; }
                    loaded.add(font.family); record.families.add(font.family); record.failed.delete(font.family); notify();
                } catch { if (valid()) { record.failed.add(font.family); notify(); } }
            });
        }
    }
    async function remove(projectId: string, font: CustomFont) {
        const record = projects.get(projectId); if (!record) return; record.revision++; record.declared.delete(`${font.sha256}.${font.format}`);
        record.families.delete(font.family); record.failed.delete(font.family); notify();
        await enqueue(font.family, async () => { if (!claimed(font.family) && loaded.delete(font.family)) await unload(font.family).catch(() => undefined); });
    }
    async function removeProjectFonts(projectId: string) {
        const user = owner; if (!user || !UUID.test(projectId)) return;
        if (storage) await storage.set(`${TOMB}${user}.${projectId}`, JSON.stringify({ owner: user, projectId }));
        const record = projects.get(projectId); projects.delete(projectId);
        generations.set(projectId, (generations.get(projectId) ?? 0) + 1); notify();
        if (record) await Promise.all([...record.families].map(family => enqueue(family, async () => {
            if (!claimed(family) && loaded.delete(family)) await unload(family).catch(() => undefined);
        })));
        erase(folder(user, projectId)); if (storage) await storage.remove(`${TOMB}${user}.${projectId}`);
    }
    return {
        setOwner, setProject, releaseProject, declare, install, hydrate, remove, removeProjectFonts,
        has: (projectId: string, family: string) => !!projects.get(projectId)?.families.has(family) && loaded.has(family),
        exportSources(projectId: string, fonts: readonly CustomFont[]) {
            const user = owner, record = projects.get(projectId); if (!user || !record) return {} as Record<string, string>;
            return Object.fromEntries(fonts.flatMap(font => {
                if (!record.families.has(font.family) || !loaded.has(font.family) || fontMetadataProblem(font)) return [];
                const file = destination(user, projectId, font);
                return file.exists && file.size === font.bytes ? [[font.family, file.uri] as const] : [];
            }));
        },
        failed: (projectId: string, family: string) => !!projects.get(projectId)?.failed.has(family),
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    };
}

export const editorFontStore = createEditorFontStore();
subscribeCacheUser((_user, reason) => { void editorFontStore.setOwner(getCacheUser() ?? null, reason === 'signout'); });
const initialOwner = getCacheUser(); if (initialOwner) void editorFontStore.setOwner(initialOwner);
export const removeProjectFonts = (projectId: string) => editorFontStore.removeProjectFonts(projectId);
