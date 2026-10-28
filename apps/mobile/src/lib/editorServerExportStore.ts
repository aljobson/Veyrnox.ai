import { getCacheUser, userDocStorage } from './appCache';
import type { CacheStorage } from './cache';
import { ApiError } from './api';
import { utf8Bytes, type ProjectDocument } from './editorBridge';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ExportBody = { document: ProjectDocument; resolution: '1080p' | '720p'; label: string; quoted_credits: number };
export type ExportRecord = { owner: string; projectId: string; key: string; body: ExportBody; credits: number; sentAt: number; jobId?: string };
const PREFIX = 'editor-server-export.';
export function checkExportBody(body: ExportBody) {
    if (utf8Bytes(JSON.stringify(body)) > 40000) throw new ApiError(400, 'render_too_large');
}
export function createExportStore(storage: CacheStorage = userDocStorage, owner = getCacheUser, now = Date.now) {
    const key = (user: string, project: string) => `${PREFIX}${user}.${project}`;
    return {
        async write(record: ExportRecord) {
            checkExportBody(record.body);
            if (!record.owner || record.owner !== owner()) throw new ApiError(0, 'account_changed');
            const slot = key(record.owner, record.projectId);
            await storage.set(slot, JSON.stringify(record));
            if (record.owner !== owner()) { await storage.remove(slot); throw new ApiError(0, 'account_changed'); }
        },
        async read(projectId: string): Promise<ExportRecord | null> {
            const user = owner();
            if (!user) return null;
            const slot = key(user, projectId);
            const raw = await storage.get(slot);
            if (!raw || user !== owner()) return null;
            try {
                const record = JSON.parse(raw) as ExportRecord;
                checkExportBody(record.body);
                if (record.owner !== user || record.projectId !== projectId || record.body.document.project_id !== projectId
                    || !UUID.test(record.key) || (record.jobId !== undefined && !UUID.test(record.jobId))
                    || !Number.isFinite(record.sentAt) || now() < record.sentAt || now() - record.sentAt > 6 * 3600000) throw new Error('expired');
                return record;
            } catch { await storage.remove(slot); return null; }
        },
        async remove(record: Pick<ExportRecord, 'owner' | 'projectId'>) {
            if (record.owner === owner()) await storage.remove(key(record.owner, record.projectId));
        },
    };
}
export const editorExportStore = createExportStore();
