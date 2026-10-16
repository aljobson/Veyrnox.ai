'use client';

import { getSession, onSessionChange } from './authClient.js';

export const SOCIAL_BRAND_KEY = 'veyrnox_publish_team_brand';
let owner;
let selected = '';
let revision = 0;
let subscribed = false;
let ended = false;
const listeners = new Set();

// Storage is an optional preference, never a prerequisite for authenticated
// requests. Keep memory authoritative after denied reads/writes/removals.
function persist() {
    try {
        if (owner && selected) localStorage.setItem(SOCIAL_BRAND_KEY, JSON.stringify({ accountId: owner, brandId: selected }));
        else localStorage.removeItem(SOCIAL_BRAND_KEY);
    } catch { /* Browser storage can be disabled; the in-memory choice still works. */ }
}
function readPreference(accountId) {
    try {
        const value = JSON.parse(localStorage.getItem(SOCIAL_BRAND_KEY));
        return value?.accountId === accountId && typeof value.brandId === 'string' ? value.brandId : '';
    } catch { return ''; }
}
function notify() { revision += 1; for (const listener of listeners) listener(); }
function syncAccount() {
    const current = getSession()?.user?.id || '';
    if (current === owner) return;
    if (owner) ended = true;
    const hydrate = owner === undefined || (!owner && !ended);
    owner = current;
    selected = current && hydrate ? readPreference(current) : '';
    if (!hydrate) persist();
    notify();
}
function subscribe() {
    if (subscribed) return;
    subscribed = true;
    onSessionChange(session => {
        if (!session) { ended = true; owner = ''; selected = ''; persist(); notify(); }
        else syncAccount();
    });
    if (typeof window !== 'undefined') window.addEventListener('storage', event => {
        if (event.key !== SOCIAL_BRAND_KEY) return;
        syncAccount();
        if (!owner) return;
        // A different account's preference is not a choice for this account.
        let value;
        try { value = event.newValue ? JSON.parse(event.newValue) : null; } catch { return; }
        if (value && value.accountId !== owner) return;
        selected = typeof value?.brandId === 'string' ? value.brandId : '';
        notify();
    });
}

export function getSelectedSocialBrand() {
    subscribe(); syncAccount();
    return selected;
}

export function setSelectedSocialBrand(brandId) {
    getSelectedSocialBrand();
    const next = owner && typeof brandId === 'string' ? brandId : '';
    if (next === selected) return;
    selected = next; persist(); notify();
}

export function onSocialBrandChange(listener) {
    getSelectedSocialBrand(); listeners.add(listener);
    return () => listeners.delete(listener);
}
export function getSocialBrandSnapshot() {
    getSelectedSocialBrand();
    return Object.freeze({ accountId: owner, brandId: selected, revision });
}
export function getSocialBrandRevision() { getSelectedSocialBrand(); return revision; }
export function assertSocialBrandSnapshot(snapshot) {
    getSelectedSocialBrand();
    if (!snapshot || snapshot.accountId !== owner || snapshot.brandId !== selected || snapshot.revision !== revision) {
        throw Object.assign(new Error('Your working brand changed. Reload your SmartLink before saving.'), { status: 409, code: 'brand_changed' });
    }
}
