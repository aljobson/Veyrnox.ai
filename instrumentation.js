import { createOnRequestError } from '@posthog/next';
import * as Sentry from '@sentry/cloudflare';
import { POSTHOG_CONSENT_KEY } from './app/lib/analyticsPrivacy.js';

const captureRequestError = createOnRequestError({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: 'https://eu.i.posthog.com',
  disabled: !process.env.NEXT_PUBLIC_POSTHOG_KEY?.startsWith('phc_'),
  consent: {
    consent_persistence_name: POSTHOG_CONSENT_KEY,
    opt_out_capturing_by_default: true,
  },
  serverOptions: {
    disable_capture_url_hashes: true,
    enableExceptionAutocapture: false,
  },
  beforeCapture: ({ properties }) => ({
    ...properties,
    analytics_source: 'next_request',
    app_environment: process.env.APP_ENV || process.env.NODE_ENV || 'unknown',
  }),
});

export async function onRequestError(error, request, context) {
  // Error messages can contain provider output or user input. Preserve stack
  // locations for source maps, but replace the message and drop cause/data.
  const safe = sanitiseServerError(error);
  // ADR-0170: the same scrubbed error goes to Sentry; both calls are no-ops while their keys are unset.
  Sentry.captureException(safe);
  await captureRequestError(safe, request, context);
}

function sanitiseServerError(error) {
  const safe = new Error('Server request failed');
  const name = error && typeof error === 'object' && typeof error.name === 'string'
    ? error.name.replace(/[^A-Za-z0-9_$.-]/g, '').slice(0, 80)
    : '';
  safe.name = name || 'ServerRequestError';
  if (error && typeof error === 'object' && typeof error.digest === 'string') {
    safe.digest = error.digest.slice(0, 160);
  }
  if (error && typeof error === 'object' && typeof error.stack === 'string') {
    const frames = error.stack.split('\n').slice(1, 31).join('\n');
    if (frames) safe.stack = `${safe.name}: ${safe.message}\n${frames}`;
  }
  return safe;
}
