import * as Sentry from '@sentry/react-native';
import { APP_ENV } from './config';
import { scrubBreadcrumb, scrubEvent } from './scrub';

// The DSN is public by design (it only allows sending events). No DSN, or a development build, means
// nothing is sent. Store privacy labels and the privacy policy must say crash data is collected.
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let started = false;

export function initCrashReporting(): boolean {
    if (started || __DEV__ || !DSN) return started;
    Sentry.init({
        dsn: DSN,
        environment: APP_ENV,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    });
    started = true;
    return true;
}

export const withCrashReporting = Sentry.wrap;

// A named warning from our own guards (a request loop was stopped), with only the tags given: nothing about the person.
export function captureIssue(message: string, tags: Record<string, string>): void {
    if (!started) return;
    Sentry.captureMessage(message, { level: 'warning', tags });
}
