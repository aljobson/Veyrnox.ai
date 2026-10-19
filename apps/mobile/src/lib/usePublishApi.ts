import { useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import type { ApiClient } from './api';
import { brandStore, withBrand } from './publishBrand';

// The signed-in API client with the chosen Publish brand added to Publish calls. It changes identity when the brand
// changes, so a screen that loads in an effect keyed on `api` reloads for the new brand.
export function usePublishApi(): ApiClient {
    const { api } = useAuth();
    const brand = useSyncExternalStore(brandStore.subscribe, brandStore.get, () => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => withBrand(api), [api, brand]);
}
