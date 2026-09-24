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
