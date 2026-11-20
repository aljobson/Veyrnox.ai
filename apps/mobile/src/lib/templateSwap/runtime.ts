import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { createSwapStore } from '../../../../../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../../../../../app/veyrnox/_lib/templateSwapActions.mjs';
import { createFileLeases } from './fileLeases';
import { createSwapGateway } from './gateway';
import { cleanOldSwapFiles, deleteSwapFile } from './files';
import { uploadSource } from '../uploads';
import { processSwapPhoto } from './photo';
import type { PickedAsset } from '../pickedImage';
import { detection } from './detection';
import { refreshSwapOffer } from './availability';
import { isOffline } from '../networkState';
import { publishBalance } from '../balanceEvents';
const leases = createFileLeases(deleteSwapFile);
export const swapStore = createSwapStore({ revoke: uri => leases.release(uri) });
let connected = false;
function connect() {
    if (connected) return;
    connected = true; cleanOldSwapFiles(); swapStore.session(getCacheUser() ?? null);
    subscribeCacheUser((user, reason) => swapStore.session(user ?? null, reason));
}
// A submit or a reconciled refund changes the balance: read it again and publish it for every balance display.
export function refreshBalanceAfterSwap(api: { getBalance: () => Promise<{ balance: number }> }) {
    const owner = getCacheUser();
    if (!owner) return;
    void api.getBalance().then(({ balance }) => { if (owner === getCacheUser()) publishBalance(owner, balance); }).catch(() => {});
}
export function useSwapRuntime(templateId: string) {
    const { api, beginSessionTask } = useAuth();
    useSyncExternalStore(swapStore.subscribe, swapStore.revision);
    useEffect(connect, []);
    const actions = useMemo(() => createSwapActions(swapStore, {
        makeKey: randomUUID,
        gateway: createSwapGateway(api, beginSessionTask),
        processPhoto: (asset, { signal }) => processSwapPhoto(asset as PickedAsset, signal, detection.detect),
        upload: (file, { signal }) => {
            if (isOffline()) throw Error('offline');
            const task = beginSessionTask();
            return uploadSource({ ...api, request: (path, init) => api.request(path, init, { task, owner: task.user ?? undefined }) }, file, file.type, () => {}, signal);
        },
        objectURL: file => leases.acquire(swapStore.owner()!, file.uri),
        revokeURL: uri => leases.release(uri),
        discardPhoto: result => result.files.forEach(file => deleteSwapFile(file.uri)),
        refreshOffer: refreshSwapOffer,
        balanceChanged: () => refreshBalanceAfterSwap(api),
    }), [api, beginSessionTask]);
    return { actions, beginSessionTask, attempts: swapStore.get(templateId), accountId: swapStore.owner() };
}
