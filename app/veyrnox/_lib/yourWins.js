'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStoredUserId, onSessionChange } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
export const nextMilestone = data => data?.milestones.find(m => !m.reached_at) ?? null;
export function seenDiff(milestones, seen) {
    const reached = milestones.filter(m => m.reached_at);
    return { seen: [...new Set([...(seen ?? []), ...reached.map(m => m.key)])],
        newest: seen == null ? null : reached.filter(m => !seen.includes(m.key))
            .sort((a, b) => Date.parse(b.reached_at) - Date.parse(a.reached_at))[0] ?? null };
}
const ownerNow = () => getStoredUserId() || '';
const noOwner = () => '';
const noSubscription = () => () => {};
const clientMounted = () => true;
const serverMounted = () => false;
const pending = new Map(), cache = new Map();
export const WINS_FRESH_MS = 5 * 60_000;
export async function fetchYourWins(owner = ownerNow(), onFetched) {
    if (!owner || owner !== ownerNow()) return null;
    const saved = cache.get(owner);
    if (saved && Date.now() - saved.at < WINS_FRESH_MS) return saved.data;
    let request = pending.get(owner);
    if (!request) {
        request = gatewayFetch('/wins').then(data => ownerNow() === owner && data?.ok === true ? data : null)
            .catch(() => null).then(data => {
                if (ownerNow() === owner) cache.set(owner, { at: Date.now(), data });
                return data;
            }).finally(() => pending.delete(owner));
        pending.set(owner, request);
    }
    const data = await request;
    if (ownerNow() !== owner) return null;
    onFetched?.(data);
    return data;
}
export function useYourWins() {
    const owner = useSyncExternalStore(onSessionChange, ownerNow, noOwner);
    const [state, setState] = useState(null);
    const mounted = useSyncExternalStore(noSubscription, clientMounted, serverMounted);
    useEffect(() => {
        if (!owner) return;
        let live = true;
        const read = () => {
            let celebrationData = null;
            void fetchYourWins(owner, data => { celebrationData = data; }).then(data => {
                if (live) setState(previous => ({ owner, data, celebrationData: celebrationData ?? (previous?.owner === owner && data ? previous.celebrationData : null) }));
            });
        };
        const visible = () => { if (document.visibilityState === 'visible') read(); };
        read(); window.addEventListener('focus', read); document.addEventListener('visibilitychange', visible);
        return () => { live = false; window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', visible); };
    }, [owner]);
    const current = state?.owner === owner ? state : null;
    return { owner, data: current?.data ?? null, celebrationData: current?.celebrationData ?? null, loading: !mounted || Boolean(owner && !current) };
}
const celebrated = new Set(), seenMemory = new Map(), serial = new Map(), reserved = new Map();
export async function seenStorageKey(owner) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner));
    return `veyrnox.wins.v1.${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export function claimWinsCelebration(owner, milestones) {
    const run = async () => {
        if (!owner || ownerNow() !== owner) return null;
        const key = await seenStorageKey(owner);
        if (ownerNow() !== owner) return null;
        let seen = seenMemory.get(key) ?? null;
        try { const saved = JSON.parse(localStorage.getItem(key)); if (Array.isArray(saved) && saved.every(s => typeof s === 'string')) seen = saved; } catch {}
        const diff = seenDiff(milestones, seen);
        const persist = () => {
            seenMemory.set(key, diff.seen);
            try { localStorage.setItem(key, JSON.stringify(diff.seen)); } catch {}
        };
        if (seen === null) { persist(); return null; }
        if (!diff.newest || celebrated.has(key) || reserved.has(key)) return null;
        const claim = {
            milestone: diff.newest,
            onShown() {
                if (reserved.get(key) !== claim || ownerNow() !== owner) return;
                celebrated.add(key); persist(); reserved.delete(key);
            },
            onCancel() { if (reserved.get(key) === claim) reserved.delete(key); },
        };
        reserved.set(key, claim);
        return claim;
    };
    const request = (serial.get(owner) ?? Promise.resolve()).then(run);
    serial.set(owner, request.catch(() => null)); return request.catch(() => null);
}

// Observe the existing native check-in dialog without changing its host or dismissal behavior.
export const checkinDialogOpen = () => Boolean(document.querySelector('dialog[aria-labelledby="checkin-title"][open]'));
export function subscribeCheckinDialog(listener) {
    const observer = new MutationObserver(listener);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
}
export function useCheckinDialogOpen() {
    return useSyncExternalStore(subscribeCheckinDialog, checkinDialogOpen, () => false);
}
