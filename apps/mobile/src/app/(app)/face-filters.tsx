import { fetch as expoFetch } from 'expo/fetch';
import { useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { FaceFiltersFlow } from '../../components/FaceFiltersFlow';
import { ApiError, API_BASE, createApiClient } from '../../lib/api';
import { aiConsent } from '../../lib/aiConsentStore';
import { getCacheUser, subscribeCacheUser, userIdFromToken } from '../../lib/appCache';

export default function FaceFiltersScreen() {
    const { status, getAccessToken, onSessionLost } = useAuth();
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    // The existing API transport, bound to the account that opened this form. Even
    // a switch during the sharing sheet cannot send this photo as the next account.
    const api = useMemo(() => createApiClient({
        baseUrl: API_BASE,
        getAccessToken: async force => {
            const token = await getAccessToken(force);
            if (!owner || getCacheUser() !== owner || !token || userIdFromToken(token) !== owner) throw new ApiError(401, 'not_authenticated');
            return token;
        },
        beforeSend: aiConsent.ensure,
        onSessionLost,
        streamFetch: expoFetch as unknown as typeof fetch,
    }), [owner, getAccessToken, onSessionLost]);
    if (status !== 'signedIn' || !owner) return null;
    return <FaceFiltersFlow key={owner} api={api} owner={owner} />;
}
