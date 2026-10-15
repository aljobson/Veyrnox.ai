'use client';

// Application code reports only short, structured signals. PostHog itself is
// owned by the root analytics manager, so feature modules never import or
// initialize another analytics client.

export const ANALYTICS_EVENT = 'veyrnox:analytics-event';
export const ANALYTICS_ERROR = 'veyrnox:analytics-error';

export function captureProductEvent(name, properties = {}) {
  dispatch(ANALYTICS_EVENT, name, properties);
}

export function captureOperationalError(name, properties = {}) {
  dispatch(ANALYTICS_ERROR, name, properties);
}

function dispatch(type, name, properties) {
  if (typeof window === 'undefined' || !/^[a-z][a-z0-9_]{1,63}$/.test(String(name))) return;
  window.dispatchEvent(new CustomEvent(type, {
    detail: { name: String(name), properties: safeProperties(properties) },
  }));
}

function safeProperties(properties) {
  const safe = {};
  if (!properties || typeof properties !== 'object') return safe;
  for (const [key, value] of Object.entries(properties)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) continue;
    if (typeof value === 'boolean' || typeof value === 'number') safe[key] = value;
    else if (typeof value === 'string' && value.length <= 160) safe[key] = value;
  }
  return safe;
}
