// Message protocol between the Veyrnox app (the "app") and the Pro editor host page
// (host.html on the child origin). Plan rev 6/7. Pure functions, no DOM, so both sides
// and the tests share one definition.
//
// Every message is a plain object with an exact key set: no extra keys are accepted.

export const PROTOCOL = 'veyrnox.pro/1';

export const LIMITS = Object.freeze({
  // Upstream FilmCraft refuses files over 512 MiB in host mode; the host is stricter-or-equal.
  maxBytes: 512 * 1024 * 1024,
  // Outgoing saves/exports have no upstream cap; bound them so one message cannot exhaust memory.
  maxSaveBytes: 4 * 1024 * 1024 * 1024,
  maxName: 255,
  maxText: 2000,
});

export const APP_TYPES = Object.freeze(['app:hello', 'app:open', 'app:shutdown', 'app:purge', 'app:cleanup']);
export const HOST_TYPES = Object.freeze([
  'host:started', 'host:engine-ready', 'host:dirty', 'host:save', 'host:failed',
  'host:restarted', 'host:purged', 'host:closed', 'host:cleaned',
]);

export const CLEAN_REASONS = Object.freeze(['none', 'owned-elsewhere', 'purge-failed', 'locks-unavailable', 'not-allowed']);

const KEYS = {
  'app:hello': ['protocol', 'type'],
  // After the handshake every app command carries the session id the host announced.
  'app:open': ['protocol', 'type', 'sessionId', 'name', 'bytes'],
  'app:shutdown': ['protocol', 'type', 'sessionId'],
  'app:purge': ['protocol', 'type', 'sessionId'],
  // Sent to purge.html (no editor, no session): wipe this origin's storage under the lock.
  'app:cleanup': ['protocol', 'type'],
  'host:started': ['protocol', 'type', 'sessionId'],
  'host:engine-ready': ['protocol', 'type', 'sessionId', 'appVersion'],
  'host:dirty': ['protocol', 'type', 'sessionId', 'dirty'],
  'host:save': ['protocol', 'type', 'sessionId', 'seq', 'engine', 'name', 'saveAs', 'bytes'],
  'host:failed': ['protocol', 'type', 'sessionId', 'reason', 'detail'],
  'host:restarted': ['protocol', 'type', 'sessionId', 'renderer', 'count'],
  'host:purged': ['protocol', 'type', 'sessionId', 'ok'],
  'host:closed': ['protocol', 'type', 'sessionId'],
  'host:cleaned': ['protocol', 'type', 'ok', 'reason'],
};

export const FAILURE_REASONS = Object.freeze([
  'not-framed', 'parent-not-allowed', 'owned-elsewhere', 'locks-unavailable',
  'purge-failed', 'engine-failed', 'restart-refused', 'bad-message', 'save-too-large', 'open-dropped',
]);

// Realm-independent: a message cloned from another window has that window's Object.prototype,
// which is not ours but is itself a root prototype (its own prototype is null).
export function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Object.prototype.toString.call(v) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

export function isArrayBuffer(v) {
  return Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

export function isSafeName(name) {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > LIMITS.maxName) return false;
  // No path separators or control characters: the name is a label, never a path.
  return !/[\\/\u0000-\u001f\u007f]/.test(name);
}

function exactKeys(obj, keys) {
  const own = Object.keys(obj);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k));
}

function bad(reason) {
  return { ok: false, reason };
}

function checkField(type, key, value) {
  switch (key) {
    case 'protocol': return value === PROTOCOL;
    case 'type': return value === type;
    case 'name': return isSafeName(value);
    case 'bytes': return isArrayBuffer(value) && value.byteLength <= (type === 'host:save' ? LIMITS.maxSaveBytes : LIMITS.maxBytes);
    case 'sessionId': return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
    case 'appVersion': return typeof value === 'string' && value.length <= 64;
    case 'dirty': case 'saveAs': case 'ok': return typeof value === 'boolean';
    case 'seq': case 'count': case 'engine': return Number.isSafeInteger(value) && value >= 0;
    case 'reason': return type === 'host:cleaned' ? CLEAN_REASONS.includes(value) : FAILURE_REASONS.includes(value);
    case 'detail': return typeof value === 'string' && value.length <= LIMITS.maxText;
    case 'renderer': return value === 'webgl' || value === 'default';
    default: return false;
  }
}

function parse(data, allowedTypes) {
  if (!isPlainObject(data)) return bad('not-an-object');
  const type = data.type;
  if (typeof type !== 'string' || !allowedTypes.includes(type)) return bad('unknown-type');
  const keys = KEYS[type];
  if (!exactKeys(data, keys)) return bad('bad-keys');
  for (const key of keys) {
    if (!checkField(type, key, data[key])) return bad('bad-field:' + key);
  }
  return { ok: true, msg: data };
}

/** Validates a message the host receives from the app. */
export function parseAppMessage(data) {
  return parse(data, APP_TYPES);
}

/** Validates a message the app receives from the host. */
export function parseHostMessage(data) {
  return parse(data, HOST_TYPES);
}

/** Builds a message. Throws on anything the matching parser would refuse. */
export function buildMessage(type, fields = {}) {
  const msg = { protocol: PROTOCOL, type, ...fields };
  const parsed = parse(msg, [...APP_TYPES, ...HOST_TYPES]);
  if (!parsed.ok) throw new Error('invalid ' + type + ': ' + parsed.reason);
  return msg;
}

/** Messages that carry bytes: the caller should transfer, not copy, the buffer. */
export function transferList(msg) {
  return isArrayBuffer(msg.bytes) ? [msg.bytes] : [];
}

/** True when `origin` is exactly one of the allowed parent origins (no wildcard, no suffix match). */
export function isAllowedParentOrigin(origin, allowed) {
  return typeof origin === 'string' && Array.isArray(allowed) && allowed.includes(origin);
}

/** Parses the allow-list written into host.html by the build: comma separated exact origins. */
export function parseAllowedParents(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(',')) {
    const item = raw.trim();
    if (!item) continue;
    let url;
    try { url = new URL(item); } catch { return []; }
    if (url.origin !== item || (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) return [];
    out.push(item);
  }
  return out;
}
