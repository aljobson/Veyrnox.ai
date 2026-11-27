import { getCacheUser, userDocStorage } from './appCache';

const key = (projectId: string) => `editor.cloud-sync.v1:${projectId}`;

/** Account-scoped opt-out. Absence preserves the existing cloud-sync behaviour. */
export async function projectCloudSyncEnabled(projectId: string): Promise<boolean> {
    if (!getCacheUser()) return true;
    return (await userDocStorage.get(key(projectId))) !== 'local-only';
}

export async function setProjectCloudSyncEnabled(projectId: string, enabled: boolean): Promise<void> {
    if (!getCacheUser()) return;
    if (enabled) await userDocStorage.remove(key(projectId));
    else await userDocStorage.set(key(projectId), 'local-only');
}
