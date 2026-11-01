import { getFreshAccessToken, getStoredUserId } from './authClient.js';

async function request(path, method, body) {
    const userId = getStoredUserId();
    const token = await getFreshAccessToken();
    if (userId !== getStoredUserId()) throw Object.assign(new Error('account_changed'), { code: 'account_changed' });
    if (!token) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    const response = await fetch(`/api/v1/mfa/recovery${path}`, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (userId !== getStoredUserId()) throw Object.assign(new Error('account_changed'), { code: 'account_changed' });
    if (!response.ok) throw Object.assign(new Error('recovery_failed'), { code: data?.error || data?.code, errorCode: data?.error_code || data?.error, status: response.status });
    return data;
}

export const generateRecoveryCodes = () => request('/codes', 'POST');
export const recoveryStatus = () => request('/codes', 'GET');
export const consumeRecoveryCode = code => request('', 'POST', { code });
