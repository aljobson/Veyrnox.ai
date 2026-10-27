import { captureEvent } from './events';
import { getAnalyticsChoice, getConsentTimestamp, isAnalyticsEnabled } from './consent';
import { appStorage, getCacheUser } from '../appCache';
// Job IDs are local correlation keys only, never analytics properties. Records
// share the grant namespace so revocation cleanup deletes them along with SDK files.
const completed = new Set<string>();
const running = new Map<string, Promise<void>>();
function context(id: string) {
    const owner = getCacheUser();
    const grant = getConsentTimestamp();
    if (!owner || !isAnalyticsEnabled() || getAnalyticsChoice() !== 'granted') return null;
    return {
        key: `veyrnox.posthog.${grant}.job.${owner}.${id}`,
        live: () => getCacheUser() === owner && getConsentTimestamp() === grant && getAnalyticsChoice() === 'granted',
    };
}
function once(key: string, work: () => Promise<void>) {
    const previous = running.get(key) ?? Promise.resolve();
    const next = previous.then(work).catch(() => undefined).finally(() => { if (running.get(key) === next) running.delete(key); });
    running.set(key, next);
    return next;
}
export async function noteGenerationSubmitted(id: string, modelId: string, kind?: string | null) {
    const scope = context(id);
    if (!scope || !kind) return;
    await once(scope.key, async () => {
        if (completed.has(scope.key) || await appStorage.get(scope.key) || !scope.live()) return;
        captureEvent('generation_submitted', { kind, model_id: modelId });
        if (!scope.live()) return;
        await appStorage.set(scope.key, JSON.stringify({ kind }));
        // A slow write completing after revoke/account change must not leave a record.
        if (!scope.live()) await appStorage.remove(scope.key);
    });
}
export async function noteGenerationFinished(id: string, outcome: string) {
    const scope = context(id);
    if (!scope) return;
    await once(scope.key, async () => {
        if (completed.has(scope.key)) return;
        const raw = await appStorage.get(scope.key);
        if (!raw || !scope.live()) return;
        const record = JSON.parse(raw) as { kind?: unknown; finished?: boolean };
        if (record.finished || !['image', 'video', 'audio'].includes(String(record.kind))) return;
        completed.add(scope.key);
        captureEvent('generation_finished', { kind: record.kind, outcome });
        if (!scope.live()) return;
        // Keep a tiny completed marker to deduplicate retries across restarts too.
        await appStorage.set(scope.key, JSON.stringify({ finished: true }));
        if (!scope.live()) await appStorage.remove(scope.key);
    });
}
