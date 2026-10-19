// Client side of the service banner (ADR-0160): how often to ask /api/status
// and how to read the answer. Kept apart from the component so it runs under
// plain Node in tests.

export const STATUS_PATH = '/api/status';
export const POLL_OK_MS = 30 * 1000;
export const POLL_DEGRADED_MS = 10 * 1000;
export const FIRST_POLL_MS = 2000;

/** 'degraded' only when the server says so; anything unreadable is "no news", never an outage. */
export function readStatus(body) {
  return body && typeof body === 'object' && body.status === 'degraded' ? 'degraded' : 'ok';
}

/** Milliseconds until the next look: quicker while a banner is showing, so it clears soon after recovery. */
export function nextPollDelay(status) {
  return status === 'degraded' ? POLL_DEGRADED_MS : POLL_OK_MS;
}
