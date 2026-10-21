import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { appStorage, getCacheUser, subscribeCacheUser } from './appCache';
import type { CacheStorage } from './cache';
import { ApiError } from './api';
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from './cinemaDrafts';
import { cleanupFor } from './cinemaUpload';

export interface UploadRecord {
    contentId: string; uploadId: string | null; size: number; fingerprint: string;
    staged: string; offset: number; startKey: string; pausedByUser: boolean;
}
export interface Ticket { readonly owner: string | null; readonly n: number }
const PREFIX = 'veyrnox.cache.v1.cinema-upload.';
const MAX_AGE = 24 * 3600000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STAGED = /^[a-f0-9-]{36}\.(mp4|mov|webm)$/;
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const root = () => new Directory(Paths.cache, 'veyrnox-cinema-upload');
function erase(entry: File | Directory) { if (entry.exists) entry.delete(); }
function slot(owner: string, contentId: string) { return `${PREFIX}${owner}.${contentId}`; }
function validRecord(r: UploadRecord, contentId: string): boolean {
    return !!r && r.contentId === contentId && UUID.test(contentId) && (r.uploadId === null || UUID.test(r.uploadId))
        && Number.isSafeInteger(r.size) && r.size > 0 && r.size <= MAX_UPLOAD_BYTES && /^[a-f0-9]{64}$/.test(r.fingerprint)
        && STAGED.test(r.staged) && Number.isSafeInteger(r.offset) && r.offset >= 0 && r.offset <= r.size
        && UUID.test(r.startKey) && typeof r.pausedByUser === 'boolean';
}
// Only the iOS system import copy, never a provider original or another feature's cache.
// DocumentPickerModule.swift:208-210 uses asCopy:true even with copyToCacheDirectory:false.
export function discardPicked(uri: string) {
    if (Platform.OS !== 'ios') return;
    try {
        const cache = Paths.cache.uri.replace(/\/?$/, '/');
        const normalize = (path: string) => decodeURIComponent(path).replace(/^\/private\/var\//, '/var/');
        const tmp = normalize(new URL('../../tmp/', cache).pathname);
        const url = new URL(uri);
        const path = normalize(url.pathname);
        if (url.protocol === 'file:' && !url.host && path.startsWith(tmp) && /\/(?:[^/]*-)?Inbox\/[^/]+$/.test(path)) erase(new File(uri));
    } catch { /* Best effort: iOS also purges its temporary imports. */ }
}
export function createUploadStore(storage: CacheStorage = appStorage, now = Date.now) {
    let epoch: Ticket = { owner: null, n: 0 };
    let initialized = false;
    let pending: Promise<unknown> = Promise.resolve();
    let runner: { ticket: Ticket; contentId: string } | null = null;
    const preparing = new Set<string>();
    const listeners = new Set<() => void>();
    const ticket = () => ({ ...epoch });
    const live = (t: Ticket) => t.owner !== null && t.owner === epoch.owner && t.n === epoch.n;
    const check = (t: Ticket) => { if (!live(t)) throw new ApiError(0, 'stale'); };
    // Serialise storage writes with owner cleanup. A late write is removed before cleanup completes.
    function serial<T>(action: () => Promise<T>): Promise<T> {
        const result = pending.then(action); pending = result.catch(() => undefined); return result;
    }
    function directory(t: Ticket, id: string) {
        if (!t.owner || !UUID.test(t.owner) || !UUID.test(id)) throw new ApiError(400, 'invalid_draft');
        return new Directory(root(), t.owner, id);
    }
    async function raw(t: Ticket, id: string) {
        if (!live(t)) return null;
        const value = await storage.get(slot(t.owner!, id)); if (!live(t) || !value) return null;
        try {
            const s = JSON.parse(value) as { savedAt: number; record: UploadRecord };
            return Number.isFinite(s.savedAt) && now() >= s.savedAt && now() - s.savedAt <= MAX_AGE && validRecord(s.record, id) ? s.record : null;
        } catch { return null; }
    }
    function save(t: Ticket, record: UploadRecord) {
        return serial(async () => {
            if (!live(t)) return;
            if (!validRecord(record, record.contentId)) throw new ApiError(400, 'invalid_video');
            const key = slot(t.owner!, record.contentId);
            await storage.set(key, JSON.stringify({ savedAt: now(), record }));
            if (!live(t)) await storage.remove(key);
        });
    }
    function clear(t: Ticket, id: string) {
        return serial(async () => {
            if (!live(t)) return;
            erase(directory(t, id));
            await storage.remove(slot(t.owner!, id));
        });
    }
    async function reconcileStaged(t: Ticket) {
        if (!live(t)) return;
        const user = new Directory(root(), t.owner!);
        if (!user.exists) return;
        for (const folder of user.list()) {
            if (!live(t)) return;
            if (!(folder instanceof Directory) || !UUID.test(folder.name)) { erase(folder); continue; }
            if (preparing.has(folder.name)) continue;
            const record = await raw(t, folder.name); if (!live(t)) return;
            if (preparing.has(folder.name)) continue;
            if (!record) { erase(folder); await storage.remove(slot(t.owner!, folder.name)); if (!live(t)) return; }
            else for (const file of folder.list()) if (file.name !== record.staged) erase(file);
        }
    }
    function setOwner(owner: string | null): Promise<void> {
        if (initialized && owner === epoch.owner) return pending.then(() => undefined);
        initialized = true;
        epoch = { owner, n: epoch.n + 1 }; // Fence every outstanding operation before any await.
        runner = null; preparing.clear(); listeners.forEach(fn => fn());
        const t = ticket();
        return serial(async () => {
            if (t.n !== epoch.n) return;
            if (cleanupFor('owner', 'owner_change') === 'delete' && root().exists) {
                for (const child of root().list()) if (child.name !== owner) erase(child);
            }
            const keys = await storage.keys(); if (t.n !== epoch.n) return;
            for (const key of keys.filter(k => k.startsWith(PREFIX) && (!owner || !k.startsWith(`${PREFIX}${owner}.`)))) {
                await storage.remove(key); if (t.n !== epoch.n) return;
            }
            await reconcileStaged(t);
        });
    }
    function acquire(t: Ticket, contentId: string): (() => void) | null {
        if (!live(t) || runner) return null;
        const lease = { ticket: t, contentId }; runner = lease; listeners.forEach(fn => fn());
        return () => { if (runner === lease) { runner = null; listeners.forEach(fn => fn()); } };
    }
    async function pick(t: Ticket, contentId: string, previous?: UploadRecord | null): Promise<UploadRecord | null> {
        check(t);
        if (preparing.has(contentId)) throw new ApiError(409, 'upload_busy');
        preparing.add(contentId);
        let uri: string | undefined, partial: File | undefined, staged: File | undefined, saved = false;
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: Object.keys(EXT), copyToCacheDirectory: false });
            uri = result.assets?.[0]?.uri;
            if (!live(t)) { if (uri) discardPicked(uri); return null; }
            if (result.canceled || !result.assets?.[0]) return null;
            const asset = result.assets[0] as DocumentPicker.DocumentPickerAsset & { duration?: number };
            const size = asset.size, ext = EXT[asset.mimeType ?? ''];
            if (!ext || !Number.isSafeInteger(size) || !size || size < 1 || size > MAX_UPLOAD_BYTES
                || (typeof asset.duration === 'number' && asset.duration > 600)) throw new ApiError(400, 'invalid_video');
            if (Paths.availableDiskSpace < size + 100 * 1024 * 1024) throw new ApiError(400, 'no_space');
            const dir = directory(t, contentId); dir.create({ intermediates: true, idempotent: true });
            const id = Crypto.randomUUID(); partial = new File(dir, `.partial-${id}`);
            const source = new File(asset.uri);
            if (Platform.OS === 'android') {
                // DestinationSink.kt:65/94 -> fsops/Utilities.kt:83-90 falls back to a stream for pipe providers.
                await source.copy(partial); check(t);
            } else {
                partial.create();
                const input = source.open(FileMode.ReadOnly);
                try {
                    const output = partial.open(FileMode.WriteOnly);
                    try {
                        let copied = 0;
                        while (copied < size) {
                            const bytes = await input.readBytes(Math.min(UPLOAD_CHUNK_BYTES, size - copied)); check(t);
                            if (!bytes.length) throw new ApiError(400, 'unreadable_video');
                            await output.writeBytes(bytes); check(t); copied += bytes.length;
                        }
                    } finally { output.close(); }
                } finally { input.close(); }
            }
            if (partial.size !== size) throw new ApiError(400, 'unreadable_video');
            staged = new File(dir, `${id}.${ext}`); await partial.move(staged); check(t);
            const fingerprint = await staged.digest('SHA-256'); check(t);
            if (previous && (previous.size !== size || previous.fingerprint !== fingerprint)) throw new ApiError(400, 'same_video_required');
            const record: UploadRecord = { contentId, uploadId: previous?.uploadId ?? null, size, fingerprint,
                staged: staged.name, offset: previous?.offset ?? 0, startKey: previous?.startKey ?? Crypto.randomUUID(), pausedByUser: previous?.pausedByUser ?? false };
            await save(t, record); check(t); saved = true;
            if (previous && previous.staged !== record.staged) erase(new File(dir, previous.staged));
            return record;
        } catch (error) {
            if (!live(t)) return null;
            if (error instanceof ApiError) throw error;
            throw new ApiError(400, Paths.availableDiskSpace < 100 * 1024 * 1024 ? 'no_space' : 'unreadable_video');
        } finally {
            if (uri) discardPicked(uri);
            if (!saved) { if (partial) erase(partial); if (staged) erase(staged); }
            if (live(t)) preparing.delete(contentId);
        }
    }
    async function verify(t: Ticket, record: UploadRecord): Promise<boolean> {
        check(t);
        try {
            const file = new File(directory(t, record.contentId), record.staged);
            if (!file.exists || file.size !== record.size) return false;
            const hash = await file.digest('SHA-256'); check(t); return hash === record.fingerprint;
        } catch { check(t); return false; }
    }
    return { ticket, live, setOwner, save, clear, read: raw, reconcileStaged, pick, verify, acquire,
        preparing, file: (t: Ticket, record: UploadRecord) => { check(t); return new File(directory(t, record.contentId), record.staged); },
        running: () => runner?.contentId ?? null,
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    };
}
export const cinemaUploadStore = createUploadStore();
subscribeCacheUser(() => { void cinemaUploadStore.setOwner(getCacheUser() ?? null).catch(() => undefined); });
export const setOwner = (owner: string | null) => cinemaUploadStore.setOwner(owner);
