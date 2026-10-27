import { Directory, File, Paths } from 'expo-file-system';
import { getCacheUser, subscribeCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import type { ApiClient } from './api';
import { putFromDisk, type PutFile } from './uploads';
import { canonicalType } from './editorServerExportUploads';
import { UUID } from './editorServerExportStore';
import type { ProjectDocument } from './editorBridge';
import type { Media, Timeline } from './nativeEditorModel';

export type DeviceFile = { file: string; type: string; size: number; seconds?: number; verified?: true };
type RecordData = { owner: string; projectId: string; items: Record<string, DeviceFile> };
const PREFIX = 'editor-device-media.';
const TOMB = 'editor-device-media-delete.';
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/quicktime': 'mov', 'audio/mp4': 'm4a' };
const root = () => new Directory(Paths.document, 'veyrnox-editor-media');
const erase = (entry: Directory | File) => { if (entry.exists) entry.delete(); };
export function createEditorMediaStore(storage: CacheStorage = userDocStorage) {
    let owner: string | null = null, epoch = 0;
    let pending: Promise<unknown> = Promise.resolve();
    let backupOff = false;
    const controllers = new Set<AbortController>();
    const serial = <T,>(fn: () => Promise<T>) => { const result = pending.then(fn); pending = result.catch(() => undefined); return result; };
    const slot = (prefix: string, user: string, project: string) => `${prefix}${user}.${project}`;
    const folder = (user: string, project: string) => {
        if (!UUID.test(user) || !UUID.test(project)) throw new Error('invalid_id');
        return new Directory(root(), user, project);
    };
    async function clean(user: string, project: string) {
        erase(folder(user, project));
        await storage.remove(slot(PREFIX, user, project));
        await storage.remove(slot(TOMB, user, project));
    }
    async function read(user: string, projectId: string): Promise<RecordData> {
        const raw = await storage.get(slot(PREFIX, user, projectId));
        try { const value = JSON.parse(raw || 'null'); if (value?.owner === user && value.projectId === projectId && value.items) return value; } catch { /* Missing/corrupt metadata does not erase files. */ }
        return { owner: user, projectId, items: {} };
    }
    function setOwner(next: string | null) {
        if (next !== owner) { epoch++; backupOff = false; controllers.forEach(c => c.abort()); controllers.clear(); }
        owner = next;
        const token = epoch;
        return serial(async () => {
            if (token !== epoch) return;
            if (root().exists) for (const child of root().list()) if (child.name !== next) erase(child);
            for (const key of await storage.keys()) {
                if (token !== epoch) return;
                if (!key.startsWith(PREFIX) && !key.startsWith(TOMB)) continue;
                const raw = await storage.get(key);
                if (token !== epoch) return;
                let record: RecordData | null = null;
                try { record = JSON.parse(raw || 'null'); } catch { /* Clean foreign metadata below. */ }
                if (!next || record?.owner !== next) await storage.remove(key);
                else if (key.startsWith(TOMB)) await clean(next, record.projectId);
            }
        });
    }
    async function copy(projectId: string, mediaId: string, uri: string, type: string, seconds?: number | null): Promise<DeviceFile | null> {
        const user = owner, token = epoch;
        return serial(async () => {
            if (!user || token !== epoch || !/^l-/.test(mediaId) || !UUID.test(mediaId.slice(2))) return null;
            let destination: File | undefined;
            try {
                const dir = folder(user, projectId); dir.create({ intermediates: true, idempotent: true });
                type = canonicalType(type);
                destination = new File(dir, `${mediaId}.${EXT[type] || 'bin'}`);
                await new File(uri).copy(destination);
                if (token !== epoch) { erase(destination); return null; }
                const item: DeviceFile = { file: destination.uri, type, size: destination.size, ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? { seconds, verified: true as const } : {}) };
                const record = await read(user, projectId);
                if (token !== epoch) { erase(destination); return null; }
                record.items[mediaId] = item;
                await storage.set(slot(PREFIX, user, projectId), JSON.stringify(record));
                if (token !== epoch) { erase(destination); await storage.remove(slot(PREFIX, user, projectId)); return null; }
                return item;
            } catch { if (destination) { try { erase(destination); } catch {} } return null; }
        });
    }
    async function files(projectId: string): Promise<Record<string, DeviceFile>> {
        const user = owner, token = epoch;
        if (!user) return {};
        const record = await read(user, projectId);
        if (token !== epoch) return {};
        const result: Record<string, DeviceFile> = {};
        for (const [id, item] of Object.entries(record.items)) {
            try {
                if (!UUID.test(id.slice(2)) || !id.startsWith('l-')) continue;
                const expected = new File(folder(user, projectId), `${id}.${EXT[item.type] || 'bin'}`);
                if (expected.uri !== item.file || !expected.exists) continue;
                result[id] = { ...item, size: expected.size };
            } catch { /* Keep metadata for older revisions, even if a file is temporarily unreadable. */ }
        }
        return result;
    }
    async function hydrate(projectId: string, document: ProjectDocument) {
        const media = (document.timeline as Timeline | undefined)?.media ?? {};
        return Object.fromEntries(Object.entries(await files(projectId)).filter(([id]) => media[id]).map(([id, file]) => [id, file.file]));
    }
    function removeProjectMedia(projectId: string) {
        const user = owner, token = epoch;
        return serial(async () => {
            if (!user || token !== epoch) return;
            await storage.set(slot(TOMB, user, projectId), JSON.stringify({ owner: user, projectId }));
            if (token !== epoch) return;
            await clean(user, projectId);
        }).catch(() => undefined);
    }
    async function backup(api: ApiClient, projectId: string, mediaId: string, file: DeviceFile, put: PutFile = putFromDisk): Promise<Media['assetSource'] | null> {
        const user = owner, token = epoch;
        if (!user || backupOff || !['video/mp4', 'audio/mpeg', 'audio/wav', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)
            || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (file.type === 'video/mp4' ? 100 : 20) * 1024 * 1024) return null;
        const controller = new AbortController(); controllers.add(controller);
        const live = () => token === epoch && !controller.signal.aborted;
        const path = `/api/v1/projects/${encodeURIComponent(projectId)}/assets`;
        try {
            const grant = await api.request<{ asset_id: string; upload_url: string; content_type: string; headers?: Record<string, string> }>(path, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `edm-${mediaId.slice(2)}` }, body: JSON.stringify({ media_type: file.type, size_bytes: file.size }) });
            if (!live() || !UUID.test(grant.asset_id) || !grant.upload_url?.startsWith('https://') || grant.content_type !== file.type) return null;
            await put(grant.upload_url, { 'Content-Type': grant.content_type, ...grant.headers }, file.file, () => {}, controller.signal);
            if (!live()) return null;
            const result = await api.request<{ state: string }>(`${path}/${encodeURIComponent(grant.asset_id)}/inspect`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: '{}' });
            return live() && result.state === 'inspected' ? { projectId, assetId: grant.asset_id } : null;
        } catch (error) { if (live() && (error as { status?: number }).status === 404) backupOff = true; return null; }
        finally { controllers.delete(controller); }
    }
    return { setOwner, copy, files, hydrate, removeProjectMedia, backup };
}
export const editorDeviceMedia = createEditorMediaStore();
export const setEditorMediaOwner = (owner: string | null) => editorDeviceMedia.setOwner(owner);
export const removeProjectMedia = (projectId: string) => editorDeviceMedia.removeProjectMedia(projectId);
subscribeCacheUser(() => { void setEditorMediaOwner(getCacheUser() ?? null).catch(() => undefined); });
