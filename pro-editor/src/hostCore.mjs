// Host page controller (plan rev 5-8). One instance per host.html document. It owns, in order:
//   hello from an allowed parent -> single-instance lock -> storage purge -> inner FilmCraft frame,
// and keeps the lock for the whole document life. All browser objects are injected so the
// state machine is tested with fakes; host-main.mjs wires the real ones.
//
// Every lifecycle operation (start, restart, teardown) runs through one queue, so a purge can
// never overlap another purge or outlive the lock that protects it. A close request is recorded
// synchronously and every continuation checks it after each await.

import {
  buildMessage, isAllowedParentOrigin, isArrayBuffer, isPlainObject, isSafeName,
  LIMITS, parseAppMessage,
} from './protocol.mjs';
import {
  acquireSessionLock, createRestartLimiter, purgeStorage, randomHex,
} from './session.mjs';

const RENDERERS = ['webgl', 'default'];
const MAX_RETIRED = 8;
const MAX_QUEUED_OPENS = 8;

/**
 * deps:
 *  selfOrigin, allowedParents[], parentWindow, ancestorOrigins (array-like or null),
 *  locks, getRoot, storage, crypto,
 *  createInner({renderer, nonce}) -> { contentWindow, destroy() },
 *  postToParent(msg, targetOrigin), postToInner(msg, targetOrigin)
 */
export function createHost(deps) {
  const limiter = createRestartLimiter();
  const state = {
    phase: 'waiting', // waiting | starting | running | closing | closed | failed
    parentOrigin: null,
    sessionId: null,
    lock: null,
    inner: null,
    engine: 0, // number of the current engine (1, 2, ...); bumps on every launch
    engineReady: false, // the current engine has announced filmcraft:ready
    queuedOpens: [], // opens that arrived before the engine was ready
    renderer: 'default', // the renderer the current engine runs; kept across restarts
    retired: [], // recently destroyed engines: their already-posted saves are still delivered
    pendingNonce: null,
    generation: 0,
    seq: 0,
    restarting: false,
    closeRequested: false,
  };

  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  const sendParent = (type, fields) => {
    if (!state.parentOrigin) return;
    deps.postToParent(buildMessage(type, { sessionId: state.sessionId, ...fields }), state.parentOrigin);
  };

  function dropQueuedOpens(detail) {
    const dropped = state.queuedOpens.length;
    state.queuedOpens = [];
    for (let i = 0; i < dropped; i += 1) sendParent('host:failed', { reason: 'open-dropped', detail });
  }

  function destroyInner() {
    state.engineReady = false;
    dropQueuedOpens('engine-destroyed');
    state.pendingNonce = null;
    state.generation += 1; // any capability from the old frame is now stale
    const inner = state.inner;
    state.inner = null;
    if (inner) {
      state.retired.push({ contentWindow: inner.contentWindow, engine: state.engine });
      if (state.retired.length > MAX_RETIRED) state.retired.shift();
      try { inner.destroy(); } catch { /* a frame that is already gone is fine */ }
    }
  }

  function releaseLock() {
    const lock = state.lock;
    state.lock = null;
    if (lock) lock.release();
  }

  function fail(reason, detail = '') {
    state.phase = 'failed';
    destroyInner();
    releaseLock();
    sendParent('host:failed', { reason, detail: String(detail).slice(0, LIMITS.maxText) });
  }

  function launch(renderer) {
    state.generation += 1;
    state.engine += 1;
    state.renderer = renderer;
    state.engineReady = false;
    state.pendingNonce = randomHex(deps.crypto);
    state.inner = deps.createInner({ renderer, nonce: state.pendingNonce });
  }

  function framingAllowed() {
    const ancestors = deps.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      return isAllowedParentOrigin(ancestors[0], deps.allowedParents);
    }
    return true; // browsers without ancestorOrigins: the hello origin check is the control
  }

  function startOp(origin) {
    return enqueue(async () => {
      if (state.closeRequested) return;
      state.phase = 'starting';
      state.parentOrigin = origin;
      state.sessionId = randomHex(deps.crypto);
      if (!framingAllowed()) { fail('parent-not-allowed'); return; }
      const lock = await acquireSessionLock(deps.locks);
      if (!lock.ok) { fail(lock.reason); return; }
      // Kept even when a close was requested meanwhile: the teardown that follows in the queue
      // purges under this lock and then releases it, so a late lock is never leaked or dropped.
      state.lock = lock;
      if (state.closeRequested) return;
      const purge = await purgeStorage({ getRoot: deps.getRoot, storage: deps.storage });
      if (!purge.ok) { fail('purge-failed', purge.detail); return; }
      if (state.closeRequested) return;
      launch('default');
      state.phase = 'running';
      sendParent('host:started', {});
    });
  }

  function teardown(reply) {
    state.closeRequested = true;
    return enqueue(async () => {
      if (state.phase === 'closed') return;
      state.phase = 'closing';
      destroyInner();
      const purge = state.lock ? await purgeStorage({ getRoot: deps.getRoot, storage: deps.storage }) : { ok: true };
      releaseLock();
      state.phase = 'closed';
      if (reply === 'purge') sendParent('host:purged', { ok: purge.ok });
      else sendParent('host:closed', {});
    });
  }

  /** Message from the parent app (event.origin, event.source, event.data). */
  function handleParentMessage({ origin, source, data }) {
    if (source !== deps.parentWindow) return { ignored: 'source' };
    if (!isAllowedParentOrigin(origin, deps.allowedParents)) return { ignored: 'origin' };
    const parsed = parseAppMessage(data);
    if (!parsed.ok) return { ignored: parsed.reason };
    const msg = parsed.msg;

    if (msg.type === 'app:hello') {
      if (state.phase === 'waiting' && !state.closeRequested) { startOp(origin); return { handled: 'start' }; }
      if (state.phase === 'running' && origin === state.parentOrigin) {
        sendParent('host:started', {}); // the app retries hello until it hears this
        return { handled: 'repeat' };
      }
      return { ignored: 'phase' };
    }
    if (origin !== state.parentOrigin) return { ignored: 'origin-changed' };
    // Every post-handshake command carries the negotiated session id: a delayed message from an
    // earlier session never reaches this one.
    if (msg.sessionId !== state.sessionId) return { ignored: 'session' };
    if (msg.type === 'app:open') {
      // During a restart there is briefly no engine: the open is held for the replacement one.
      if (state.phase !== 'running' || (!state.inner && !state.restarting)) {
        sendParent('host:failed', { reason: 'open-dropped', detail: 'not-running' });
        return { ignored: 'phase' };
      }
      if (!state.engineReady) {
        // The engine installs its message listener only when it is ready: hold the payload.
        if (state.queuedOpens.length >= MAX_QUEUED_OPENS) {
          sendParent('host:failed', { reason: 'open-dropped', detail: 'queue-full' });
          return { handled: 'rejected' };
        }
        state.queuedOpens.push({ name: msg.name, bytes: msg.bytes });
        return { handled: 'queued' };
      }
      deps.postToInner({ type: 'filmcraft:open', name: msg.name, bytes: msg.bytes }, deps.selfOrigin);
      return { handled: 'open' };
    }
    if (msg.type === 'app:shutdown') { teardown('shutdown'); return { handled: 'shutdown' }; }
    if (msg.type === 'app:purge') { teardown('purge'); return { handled: 'purge' }; }
    return { ignored: 'type' };
  }

  function identifyEngine(source) {
    if (state.inner && source === state.inner.contentWindow) return { engine: state.engine, current: true };
    const retired = state.retired.find((r) => r.contentWindow && r.contentWindow === source);
    return retired ? { engine: retired.engine, current: false } : null;
  }

  /** Message from an inner FilmCraft frame (same origin as this page). */
  function handleInnerMessage({ origin, source, data }) {
    if (origin !== deps.selfOrigin) return { ignored: 'source' };
    const who = identifyEngine(source);
    if (!who) return { ignored: 'source' };
    if (!isPlainObject(data) || typeof data.type !== 'string') return { ignored: 'shape' };
    // A retired engine may still deliver a save it queued before it was destroyed; nothing else.
    if (!who.current && data.type !== 'filmcraft:save') return { ignored: 'retired' };
    switch (data.type) {
      case 'filmcraft:ready':
        if (who.current && !state.engineReady) {
          state.engineReady = true;
          const queued = state.queuedOpens;
          state.queuedOpens = [];
          for (const item of queued) deps.postToInner({ type: 'filmcraft:open', name: item.name, bytes: item.bytes }, deps.selfOrigin);
        }
        sendParent('host:engine-ready', { appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 64) : '' });
        return { handled: 'ready' };
      case 'filmcraft:dirty':
        sendParent('host:dirty', { dirty: data.dirty === true });
        return { handled: 'dirty' };
      case 'filmcraft:save': {
        if (!isArrayBuffer(data.bytes)) return { ignored: 'bytes' };
        const name = isSafeName(data.name) ? data.name : 'unnamed';
        if (data.bytes.byteLength > LIMITS.maxSaveBytes) {
          sendParent('host:failed', { reason: 'save-too-large', detail: name });
          return { handled: 'too-large' };
        }
        state.seq += 1;
        sendParent('host:save', {
          seq: state.seq, engine: who.engine, name, saveAs: data.saveAs === true, bytes: data.bytes,
        });
        return { handled: 'save' };
      }
      case 'filmcraft:failed':
        sendParent('host:failed', { reason: 'engine-failed', detail: String(data.error || '').slice(0, LIMITS.maxText) });
        return { handled: 'failed' };
      default:
        return { ignored: 'type' };
    }
  }

  /** Called by the gate inside the inner frame. Returns a restart capability or null. */
  function consume(nonce) {
    if ((state.phase !== 'starting' && state.phase !== 'running') || state.pendingNonce === null) return null;
    if (typeof nonce !== 'string' || nonce !== state.pendingNonce) return null;
    state.pendingNonce = null; // single use
    const generation = state.generation;
    return (request) => requestRestart(generation, request);
  }

  function requestRestart(generation, request) {
    if (generation !== state.generation || state.phase !== 'running' || state.restarting || state.closeRequested) return false;
    // The request object comes from the inner window (another realm): read primitives only.
    const asked = request !== null && typeof request === 'object' ? request.renderer : undefined;
    if (typeof asked !== 'string' || !RENDERERS.includes(asked)) return false;
    // 'default' means "restart as is": keep the renderer that already works (e.g. WebGL after a
    // WebGPU failure). Only an explicit 'webgl' request switches it.
    const renderer = asked === 'webgl' ? 'webgl' : state.renderer;
    if (!limiter.take()) {
      sendParent('host:failed', { reason: 'restart-refused', detail: 'limit' });
      return false;
    }
    state.restarting = true;
    enqueue(async () => {
      try {
        if (state.closeRequested || state.phase !== 'running') return;
        destroyInner(); // engine and its async writers go away first
        const purge = await purgeStorage({ getRoot: deps.getRoot, storage: deps.storage });
        if (!purge.ok) { fail('purge-failed', purge.detail); return; }
        if (state.closeRequested || state.phase !== 'running') return;
        launch(renderer); // the lifetime lock is still held: no handoff
        sendParent('host:restarted', { renderer, count: limiter.count });
      } finally {
        state.restarting = false;
      }
    });
    return true;
  }

  return {
    handleParentMessage,
    handleInnerMessage,
    consume,
    get phase() { return state.phase; },
    get sessionId() { return state.sessionId; },
    /** Resolves when every queued lifecycle operation has finished (tests, shutdown hooks). */
    idle() { return chain; },
  };
}
