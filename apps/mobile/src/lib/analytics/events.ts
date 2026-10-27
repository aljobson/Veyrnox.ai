// Same primitive-property rules as the website's analyticsClient.js.
export function safeProperties(input: unknown): Record<string, string | number | boolean> {
    const safe: Record<string, string | number | boolean> = {};
    if (!input || typeof input !== 'object') return safe;
    for (const [key, value] of Object.entries(input)) {
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) continue;
        if (typeof value === 'boolean' || typeof value === 'number') safe[key] = value;
        else if (typeof value === 'string' && value.length <= 160) safe[key] = value;
    }
    return safe;
}
const oneOf = (...values: string[]) => (v: unknown) => typeof v === 'string' && values.includes(v);
const identifier = (v: unknown) => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(v);
const kind = oneOf('image', 'video', 'audio', 'speech', 'music', 'sound', 'text', '3d', 'edit');
const outcome = oneOf('succeeded', 'failed', 'cancelled');
export const APPLICATION_EVENTS: Record<string, Record<string, (v: unknown) => boolean>> = {
    app_opened: { cold: v => typeof v === 'boolean' }, app_backgrounded: {},
    onboarding_step: { step: oneOf('welcome', 'start', 'vibe'), action: oneOf('view', 'next', 'skip') },
    sign_in_completed: { method: oneOf('apple', 'google', 'email', 'passkey') },
    generation_submitted: { kind, model_id: identifier }, generation_finished: { kind, outcome },
    purchase_started: { product: oneOf('pack', 'subscription') },
    purchase_finished: { product: oneOf('pack', 'subscription'), outcome },
    language_changed: { locale: oneOf('en', 'es', 'zh', 'hi', 'ar', 'fr', 'pt-BR', 'pt', 'ru', 'ja', 'de', 'ko') },
    appearance_changed: { theme: oneOf('system', 'light', 'dark', 'oled'), accent: identifier },
};
export function eventProperties(name: string, input: unknown) {
    if (!Object.hasOwn(APPLICATION_EVENTS, name)) return null;
    const rules = APPLICATION_EVENTS[name];
    return Object.fromEntries(Object.entries(safeProperties(input)).filter(([key, value]) => Object.hasOwn(rules, key) && rules[key](value)));
}
// Screen names come only from useSegments, which supplies filesystem patterns, not URLs.
export const routePattern = (segments: readonly string[]) => '/' + segments.join('/');
export const SDK_EVENTS = new Set(['$identify', '$screen']);
type Envelope = { event: string; properties?: Record<string, any>; $set?: unknown; $set_once?: unknown };
export function sanitizeEnvelope<T extends Envelope>(event: T): T | null {
    const app = eventProperties(event.event, event.properties);
    if (app === null && !SDK_EVENTS.has(event.event)) return null;
    const source = event.properties ?? {};
    const properties: Record<string, any> = { ...(app ?? {}) };
    // token is required by core's before_send contract. No device or person properties survive.
    for (const key of ['token', 'distinct_id', '$anon_distinct_id']) if (typeof source[key] === 'string') properties[key] = source[key];
    if (event.event === '$screen' && typeof source.$screen_name === 'string') properties.$screen_name = source.$screen_name;
    const { $set, $set_once, ...rest } = event;
    return { ...rest, properties } as T;
}

// Feature imports stay free of native storage and SDK lifecycle dependencies.
let sink: ((name: string, properties: Record<string, string | number | boolean>) => void) | undefined;
export function setEventSink(next: typeof sink) { sink = next; }
export function captureEvent(name: string, props: unknown = {}) {
    const safe = eventProperties(name, props);
    if (safe) sink?.(name, safe);
}
