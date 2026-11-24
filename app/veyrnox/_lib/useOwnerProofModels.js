'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getStoredSession, getAccessToken, onSessionChange } from '../../lib/authClient.js';
import { createOwnerProofStore, ownerProofTokenEligible, readOwnerProof, mergeOwnerProofModels } from '../../../lib/ownerProofOverlay.mjs';
import { fromApi } from './useCatalog.js';

const store = createOwnerProofStore();
const identity = () => getStoredSession()?.user?.id || null;
const noIdentity = () => null;
const serverSnapshot = () => store.snapshot(null);
let mounted = 0;
export function useOwnerProofModels() {
    const owner = useSyncExternalStore(onSessionChange, identity, noIdentity);
    const models = useSyncExternalStore(store.subscribe, () => store.snapshot(owner), serverSnapshot);
    useEffect(() => {
        mounted++;
        const refresh = (force = false) => {
            const current = identity();
            store.session(current);
            const token = getAccessToken();
            if (current === owner && current && ownerProofTokenEligible(token)) {
                void store.refresh(current, () => readOwnerProof('/api/v1/owner-proof', token), force);
            }
        };
        const changed = () => refresh(true);
        const unsubscribe = onSessionChange(changed);
        refresh();
        window.addEventListener('focus', changed);
        return () => {
            unsubscribe(); window.removeEventListener('focus', changed);
            if (--mounted === 0) store.session(null);
        };
    }, [owner]);
    return models;
}

export function useOwnerProofCatalog(models) {
    const privateModels = useOwnerProofModels();
    return useMemo(() => mergeOwnerProofModels(models, fromApi(privateModels).map(model => ({ ...model, ownerProofImage: !!model.media?.image && !models.find(publicModel => publicModel.id === model.id)?.media?.image }))), [models, privateModels]);
}
