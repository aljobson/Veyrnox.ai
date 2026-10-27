import type { PostHog } from 'posthog-react-native';
import { appStorage } from '../appCache';
import { config } from '../config';
import { getAnalyticsChoice, getConsentTimestamp, isAnalyticsEnabled, readConsent, subscribeConsent, writeConsent } from './consent';
import { captureEvent, setEventSink, sanitizeEnvelope } from './events';
export { captureEvent } from './events';
import { createTransportToken } from './transport';
const PREFIX = 'veyrnox.posthog.';
let client: PostHog | undefined;
let transport: ReturnType<typeof createTransportToken> | undefined;
let user: string | null = null;
let identified: string | null = null;
let cleanup = Promise.resolve();
let starting: Promise<void> | undefined;
let epoch = 0;
const writes = new Set<Promise<void>>();
const allowed = () => isAnalyticsEnabled() && getAnalyticsChoice() === 'granted';
setEventSink((name, properties) => { if (allowed() && client) client.capture(name, properties); });
export function captureScreen(pattern: string) {
    if (allowed() && client && /^\/[a-zA-Z0-9_()/[\].-]*$/.test(pattern)) void client.screen(pattern);
}
export function setAnalyticsUser(id: string | null) {
    user = id;
    if (!client || !allowed() || identified === id) return;
    if (identified !== null) client.reset();
    identified = id;
    if (id) client.identify(id);
}
async function clearFiles() {
    const keys = await appStorage.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX)).map(key => appStorage.remove(key)));
}
function revoke() {
    epoch++;
    transport?.revoke(); // Must precede optOut/reset, including their async SDK work.
    const old = client;
    client = undefined; transport = undefined; identified = null;
    cleanup = cleanup.then(async () => {
        if (old) {
            await old.optOut().catch(() => undefined);
            old.reset(); // Identity reset is not the privacy boundary.
            await old.flush().catch(() => undefined); // Drain through permanently blocked transport.
        }
        await Promise.allSettled([...writes]);
        await clearFiles();
    }).catch(() => undefined);
}
subscribeConsent(() => { if (!allowed()) revoke(); });
export async function startAnalytics(): Promise<void> {
    if (!isAnalyticsEnabled()) return;
    await readConsent();
    if (!allowed() || client) return;
    if (starting) { await starting; if (allowed() && !client) return startAnalytics(); return; }
    const version = epoch;
    starting = (async () => {
        await cleanup;
        if (!allowed() || version !== epoch) return;
        // No runtime SDK import, native probes, or SDK side effects before grant.
        const { PostHog } = require('posthog-react-native') as typeof import('posthog-react-native');
        const host = `${config.apiBase.replace(/\/$/, '')}/ingest`;
        const gate = createTransportToken(host);
        transport = gate;
        // Each saved grant has a separate namespace: failed deletion cannot resurrect
        // a revoked queue under a fresh transport, even after a process restart.
        const namespace = `${PREFIX}${getConsentTimestamp()}.`;
        client = new PostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY!, {
            host, persistence: 'file',
            customStorage: {
                getItem: key => gate.token.active ? appStorage.get(namespace + key) : Promise.resolve(null),
                setItem: async (key, value) => {
                    if (!gate.token.active) return;
                    const write = appStorage.set(namespace + key, value);
                    writes.add(write);
                    try { await write; } finally { writes.delete(write); }
                },
            },
            requestHeaders: gate.headers,
            captureAppLifecycleEvents: false, enableSessionReplay: false,
            preloadFeatureFlags: false, disableRemoteFeatureFlags: true, disableSurveys: true,
            errorTracking: { autocapture: false },
            before_send: event => gate.token.active ? sanitizeEnvelope(event) : null,
        });
        await client.ready();
        if (!gate.token.active) return;
        if (user !== null && client.getDistinctId() !== user) { client.reset(); identified = null; }
        setAnalyticsUser(user);
        captureEvent('app_opened', { cold: true });
    })().catch(() => { revoke(); }).finally(() => { starting = undefined; });
    await starting;
}
export async function chooseAnalytics(value: 'granted' | 'denied') {
    if (value === 'granted' && allowed() && client) return;
    await writeConsent(value);
    if (value === 'granted') await startAnalytics();
    else await cleanup;
}
