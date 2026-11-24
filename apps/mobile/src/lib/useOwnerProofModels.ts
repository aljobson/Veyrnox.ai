import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { internalModelId } from './publicModelIds';
import { isSupported, type CatalogModel } from './media';
import { API_BASE } from './api';
import { createOwnerProofStore, ownerProofTokenEligible, readOwnerProof, mergeOwnerProofModels } from '../../../../lib/ownerProofOverlay.mjs';

const store = createOwnerProofStore<CatalogModel>();
const serverSnapshot = () => store.snapshot(null);
let mounted = 0;
export function useOwnerProofModels() {
    const { status, generation, sessionGeneration, canReloadSession, getDiscoveryToken } = useAuth();
    const session = status === 'signedIn' ? generation : null;
    const models = useSyncExternalStore(store.subscribe, () => store.snapshot(session), serverSnapshot);
    useEffect(() => {
        mounted++;
        store.session(session);
        const refresh = (force = false) => {
            const token = getDiscoveryToken?.();
            if (session !== null && sessionGeneration() === session && token && ownerProofTokenEligible(token)) {
                void store.refresh(session, async () => {
                    const data = await readOwnerProof<CatalogModel>(`${API_BASE}/api/v1/owner-proof`, token);
                    return { models: data.models?.map(m => ({ ...m, id: internalModelId(m.id) })) };
                }, force);
            }
        };
        refresh();
        const subscription = AppState.addEventListener('change', next => {
            if (next === 'active') refresh(true);
        });
        return () => { subscription.remove(); if (--mounted === 0) store.session(null); };
    }, [session, sessionGeneration, getDiscoveryToken]);
    // Same-account token refresh / MFA step-up: retain models and revalidate silently.
    useEffect(() => {
        const token = getDiscoveryToken?.();
        if (session !== null && token && ownerProofTokenEligible(token)) {
            void store.refresh(session, async () => {
                const data = await readOwnerProof<CatalogModel>(`${API_BASE}/api/v1/owner-proof`, token);
                return { models: data.models?.map(m => ({ ...m, id: internalModelId(m.id) })) };
            }, true);
        }
    }, [session, canReloadSession, getDiscoveryToken]);
    return models;
}

export function useOwnerProofCatalog(models: CatalogModel[], includeClip = false): CatalogModel[] {
    const privateModels = useOwnerProofModels();
    return useMemo(() => mergeOwnerProofModels(models, includeClip ? privateModels : privateModels.filter(isSupported)), [models, privateModels, includeClip]);
}
