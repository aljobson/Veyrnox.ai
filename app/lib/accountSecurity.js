'use client';
import { gotrueAuthed, getSession, clearSession } from './authClient.js';

export async function requestPasswordCode() {
    return gotrueAuthed('/auth/v1/reauthenticate', { method: 'GET' });
}
export async function changePassword(password, nonce) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new Error('Use a password between 8 and 72 characters.');
    if (typeof nonce !== 'string' || !/^[0-9]{6,10}$/.test(nonce)) throw new Error('Enter the verification code from your email.');
    return gotrueAuthed('/auth/v1/user', { method: 'PUT', body: { password, nonce } });
}
export async function revokeSessions(scope) {
    if (!['others', 'global'].includes(scope)) throw new Error('Invalid session scope');
    const account = getSession()?.user?.id;
    await gotrueAuthed(`/auth/v1/logout?scope=${scope}`, { method: 'POST' });
    if (scope === 'global' && getSession()?.user?.id === account) clearSession();
}

// Signed-in devices (ADR-0363). The current session id is the session_id claim of our own
// access token; it only marks "This device" and is never trusted by the server.
export function currentSessionId() {
    try {
        const part = getSession()?.access_token?.split('.')[1];
        if (!part) return '';
        const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
        return typeof claims.session_id === 'string' ? claims.session_id : '';
    } catch { return ''; }
}
export async function listDevices() {
    const { gatewayFetch } = await import('../veyrnox/_lib/gateway.js');
    const data = await gatewayFetch('/account/sessions');
    return Array.isArray(data?.sessions) ? data.sessions : [];
}
export async function endDevice(id) {
    const { gatewayFetch } = await import('../veyrnox/_lib/gateway.js');
    return gatewayFetch('/account/sessions', { method: 'DELETE', body: JSON.stringify({ id }) });
}
