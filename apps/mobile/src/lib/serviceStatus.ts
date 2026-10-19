import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { API_BASE } from './api';

// Is our database provider failing? Read from GET /api/status (ADR-0160), the same word the website banner uses.
// Only an explicit "degraded" counts: a failed request, a bad body or "unknown" is no news, because a phone that
// cannot reach us at all is offline, and the offline strip already says that.

export type ServiceStatus = 'ok' | 'degraded';

export const POLL_OK_MS = 30_000;
export const POLL_DEGRADED_MS = 10_000;
const REQUEST_TIMEOUT_MS = 4000;

export function readServiceStatus(body: unknown): ServiceStatus {
    return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'degraded' ? 'degraded' : 'ok';
}

export const nextPollDelay = (status: ServiceStatus): number => (status === 'degraded' ? POLL_DEGRADED_MS : POLL_OK_MS);

async function fetchStatus(): Promise<ServiceStatus | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${API_BASE}/api/status`, { signal: controller.signal });
        return res.ok ? readServiceStatus(await res.json()) : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Polls while the app is in the foreground; quicker while the notice shows so it clears soon after recovery.
export function useServiceStatus(): ServiceStatus {
    const [status, setStatus] = useState<ServiceStatus>('ok');
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        let current: ServiceStatus = 'ok';
        const schedule = (ms: number) => {
            if (timer) clearTimeout(timer);
            if (!stopped) timer = setTimeout(check, ms);
        };
        async function check() {
            if (AppState.currentState !== 'active') return; // the 'active' listener below resumes it
            const next = await fetchStatus();
            if (stopped) return;
            if (next) {
                current = next;
                setStatus(next);
            }
            schedule(nextPollDelay(current));
        }
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') void check();
        });
        schedule(2000);
        return () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            sub.remove();
        };
    }, []);
    return status;
}
