// Shared, dependency-free privacy rules for browser analytics. Keeping these
// pure makes the redaction and replay boundary easy to pin in node:test.

export const POSTHOG_CONSENT_KEY = 'veyrnox_analytics_consent';
export const ANALYTICS_PREFERENCE_KEY = 'veyrnox_analytics_preference_v1';

export function normaliseReplaySampleRate(value, fallback = 0.2) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function setReplayCapture(posthog, { enabled, forceSampling = false }) {
  if (!enabled) {
    posthog.stopSessionRecording();
    posthog.set_config({ disable_session_recording: true });
    return;
  }

  // The provider starts with replay disabled so no recorder can run before
  // consent. Clear that runtime gate before asking PostHog to start recording.
  posthog.set_config({ disable_session_recording: false });
  if (forceSampling) posthog.startSessionRecording({ sampling: true });
  else posthog.startSessionRecording();
}

const BLOCKED_REPLAY_PREFIXES = [
  '/auth',
  '/app/account',
  '/app/admin',
  '/app/credits',
  '/social/connect/callback',
];

const URL_PROPERTIES = [
  '$current_url',
  '$initial_current_url',
  '$session_entry_url',
  '$referrer',
  '$external_click_url',
];

export function replayAllowedOnPath(pathname) {
  const path = normalisePathname(pathname);
  return !BLOCKED_REPLAY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function pathOnlyUrl(value, origin = 'https://veyrnox.ai') {
  if (typeof value !== 'string' || !value) return value;
  try {
    const parsed = new URL(value, origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return normalisePathname(value.split(/[?#]/, 1)[0]);
  }
}

export function sanitisePostHogEvent(event, origin = 'https://veyrnox.ai') {
  if (!event || typeof event !== 'object' || !event.properties) return event;
  const properties = { ...event.properties };
  for (const key of URL_PROPERTIES) {
    if (properties[key]) properties[key] = pathOnlyUrl(properties[key], origin);
  }

  // Autocapture can put link destinations in its element chain. Keep the
  // structural signal while removing queries and fragments (OAuth state,
  // referral codes, checkout ids, and similar values must never leave).
  if (Array.isArray(properties.$elements)) {
    properties.$elements = properties.$elements.map((element) => {
      if (!element || typeof element !== 'object') return element;
      const next = { ...element };
      for (const key of Object.keys(next)) {
        if (key === 'attr__href' || key === 'attr__src') delete next[key];
      }
      return next;
    });
  }

  // Browser error messages can contain rejected provider responses, prompt
  // fragments, or values interpolated by application code. Error type and
  // frame locations are enough for grouping and source maps; source context
  // and captured variables are deliberately discarded.
  if (Array.isArray(properties.$exception_list)) {
    properties.$exception_list = properties.$exception_list.map(sanitiseException);
  }
  if ('$exception_message' in properties) properties.$exception_message = 'Browser error';
  if (Array.isArray(properties.$exception_values)) {
    properties.$exception_values = properties.$exception_values.map(() => 'Browser error');
  }

  return { ...event, properties };
}

function sanitiseException(exception) {
  if (!exception || typeof exception !== 'object') return exception;
  const next = { ...exception, value: 'Browser error' };
  const frames = exception.stacktrace?.frames;
  if (!Array.isArray(frames)) return next;
  next.stacktrace = {
    ...exception.stacktrace,
    frames: frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return frame;
      const clean = { ...frame };
      for (const key of ['filename', 'abs_path']) {
        if (typeof clean[key] === 'string') clean[key] = clean[key].split(/[?#]/, 1)[0];
      }
      delete clean.context_line;
      delete clean.pre_context;
      delete clean.post_context;
      delete clean.vars;
      return clean;
    }),
  };
  return next;
}

export function readAnalyticsPreference(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ANALYTICS_PREFERENCE_KEY) || 'null');
    if (parsed?.version !== 1 || typeof parsed.analytics !== 'boolean' || typeof parsed.replay !== 'boolean') return null;
    return { analytics: parsed.analytics, replay: parsed.analytics && parsed.replay };
  } catch {
    return null;
  }
}

export function writeAnalyticsPreference(storage, preference) {
  const value = {
    version: 1,
    analytics: Boolean(preference?.analytics),
    replay: Boolean(preference?.analytics && preference?.replay),
  };
  try {
    storage?.setItem(ANALYTICS_PREFERENCE_KEY, JSON.stringify(value));
  } catch {
    // PostHog's consent cookie remains authoritative when localStorage is
    // blocked; replay falls back to off on the next visit.
  }
  return value;
}

export function normaliseGatewayPath(path) {
  const clean = normalisePathname(path);
  return clean
    .split('/')
    .map((part) => (/^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) ? ':id' : part))
    .join('/');
}

function normalisePathname(value) {
  const raw = typeof value === 'string' && value ? value : '/';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/');
}
