/**
 * Rough device label from a sign-in session's user agent (ADR-0363). Names are
 * proper nouns (Chrome, macOS), so only `kind` is translated by the clients.
 * Never returns the raw user agent.
 *   kind: 'app_ios' | 'app_android' | 'browser' | 'unknown'
 */
const BROWSERS = [
    [/Edg(?:e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/Firefox\/|FxiOS\//, 'Firefox'],
    [/CriOS\/|Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
];
const SYSTEMS = [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
];

const first = (table, ua) => table.find(([re]) => re.test(ua))?.[1] ?? null;

export function describeSessionDevice(userAgent) {
    const ua = typeof userAgent === 'string' ? userAgent.slice(0, 300) : '';
    if (!ua) return { kind: 'unknown', browser: null, system: null };
    if (!/Mozilla\//.test(ua)) {
        if (/CFNetwork|Darwin/.test(ua)) return { kind: 'app_ios', browser: null, system: 'iPhone' };
        if (/okhttp|Dalvik/i.test(ua)) return { kind: 'app_android', browser: null, system: 'Android' };
        return { kind: 'unknown', browser: null, system: null };
    }
    const browser = first(BROWSERS, ua);
    const system = first(SYSTEMS, ua);
    return browser || system ? { kind: 'browser', browser, system } : { kind: 'unknown', browser: null, system: null };
}
