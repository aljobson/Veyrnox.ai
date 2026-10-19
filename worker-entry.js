/**
 * Worker entry named by wrangler.jsonc `main` (ADR-0170): worker.js with Sentry around it.
 * Kept apart so worker.js stays the plain handler its tests call. With no DSN committed
 * (lib/sentryConfig.js) the wrapper sends nothing.
 */
import * as Sentry from '@sentry/cloudflare';
import worker from './worker.js';
import { sentryOptions } from './lib/sentryConfig.js';

export default Sentry.withSentry((env) => sentryOptions(env), worker);
