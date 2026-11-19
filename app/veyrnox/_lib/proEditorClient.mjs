// App-side driver for the Pro editor host page (ADR-0358). The host page lives on the child
// origin; this module talks to it over the versioned postMessage protocol and nothing else. All
// browser objects are passed in, so it is tested with fakes. It never touches FilmCraft itself.

import { buildMessage, parseHostMessage, transferList } from '../../../pro-editor/src/protocol.mjs';

const HELLO_EVERY_MS = 250;
const HELLO_TRIES = 40;
const PURGE_TIMEOUT_MS = 5000;
const STARTUP_FAILURES = ['not-framed', 'parent-not-allowed', 'owned-elsewhere', 'locks-unavailable', 'purge-failed'];

/**
 * deps: win (addEventListener/removeEventListener), getFrame() -> iframe element or null,
 *       childOrigin (exact origin of host.html), onEvent(event),
 *       setIntervalFn / clearIntervalFn (default: globals)
 */
export function createProEditorClient(deps) {
    const setIntervalFn = deps.setIntervalFn || setInterval;
    const clearIntervalFn = deps.clearIntervalFn || clearInterval;
    const state = { phase: 'idle', sessionId: null, timer: null, tries: 0, timedOut: false };

    const frameWindow = () => deps.getFrame()?.contentWindow || null;

    function emit(event) {
        try { deps.onEvent(event); } catch { /* a listener bug must not break the protocol */ }
    }

    function stopHello() {
        if (state.timer !== null) { clearIntervalFn(state.timer); state.timer = null; }
    }

    function post(type, fields = {}) {
        const target = frameWindow();
        if (!target) return false;
        const msg = buildMessage(type, fields);
        target.postMessage(msg, deps.childOrigin, transferList(msg));
        return true;
    }

    function onMessage(event) {
        if (event.origin !== deps.childOrigin || event.source !== frameWindow()) return;
        const parsed = parseHostMessage(event.data);
        if (!parsed.ok) return;
        const msg = parsed.msg;
        if (msg.type === 'host:cleaned') return; // answered by the purge page, never by this host
        if (msg.type === 'host:started') {
            if (state.sessionId && msg.sessionId !== state.sessionId) return;
            state.sessionId = msg.sessionId;
            // A host slow to start (its storage wipe can outlast the hello deadline) still
            // becomes a normal session: recover from a timeout, but never from a real failure.
            if (state.phase === 'connecting' || (state.phase === 'failed' && state.timedOut)) {
                state.phase = 'started';
                state.timedOut = false;
                stopHello();
            }
            emit({ type: msg.type, sessionId: msg.sessionId });
            return;
        }
        // The host reports startup failures (another tab owns the editor, no Web Locks, a wipe that
        // failed) before it ever starts a session: accept those from this exact frame and origin.
        if (msg.type === 'host:failed' && state.phase === 'connecting' && STARTUP_FAILURES.includes(msg.reason)) {
            state.sessionId = msg.sessionId;
            state.phase = 'failed';
            stopHello();
            const early = { ...msg };
            delete early.protocol;
            emit(early);
            return;
        }
        // Everything else must belong to the negotiated session.
        if (!state.sessionId || msg.sessionId !== state.sessionId) return;
        if (msg.type === 'host:failed') {
            const terminal = STARTUP_FAILURES.includes(msg.reason);
            if (terminal) { state.phase = 'failed'; stopHello(); }
        }
        if (msg.type === 'host:closed' || msg.type === 'host:purged') { state.phase = 'closed'; stopHello(); }
        const rest = { ...msg };
        delete rest.protocol;
        emit(rest);
    }

    function connect() {
        const retry = state.phase === 'failed' && state.timedOut;
        if (state.phase !== 'idle' && !retry) return;
        state.phase = 'connecting';
        state.timedOut = false;
        state.tries = 0;
        if (!retry) deps.win.addEventListener('message', onMessage);
        const tick = () => {
            if (state.phase !== 'connecting') { stopHello(); return; }
            if (state.tries >= HELLO_TRIES) {
                state.phase = 'failed';
                state.timedOut = true;
                stopHello();
                emit({ type: 'host:failed', reason: 'timeout', detail: 'the editor host did not answer' });
                return;
            }
            state.tries += 1;
            post('app:hello'); // the host script may not be listening yet: retry until it answers
        };
        state.timer = setIntervalFn(tick, HELLO_EVERY_MS);
        tick();
    }

    const command = (type, fields) => state.phase === 'started' && !!state.sessionId
        && post(type, { sessionId: state.sessionId, ...fields });

    return {
        connect,
        /** Hands a file to the editor. The buffer is transferred, so the caller keeps nothing. */
        open: (name, bytes) => command('app:open', { name, bytes }),
        shutdown: () => command('app:shutdown', {}),
        purge: () => command('app:purge', {}),
        /** Detaches listeners and timers without telling the host (the frame is being removed). */
        dispose() {
            stopHello();
            deps.win.removeEventListener('message', onMessage);
            state.phase = 'closed';
        },
        get phase() { return state.phase; },
        get sessionId() { return state.sessionId; },
    };
}

/**
 * Loads the wasm-free purge page in a throw-away frame, asks for cleanup and removes the frame
 * when it answers or after `timeoutMs`. Resolves { ok, reason } and never rejects.
 * deps: win, childOrigin, createFrame(src) -> iframe element (already attached), timeoutMs,
 *       setIntervalFn / clearIntervalFn / setTimeoutFn
 */
export function runPurgePage(deps) {
    const setIntervalFn = deps.setIntervalFn || setInterval;
    const clearIntervalFn = deps.clearIntervalFn || clearInterval;
    const setTimeoutFn = deps.setTimeoutFn || setTimeout;
    const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
    return new Promise((resolve) => {
        let frame = null;
        let timer = null;
        let guard = null;
        let finished = false;
        const done = (result) => {
            if (finished) return;
            finished = true;
            if (timer !== null) clearIntervalFn(timer);
            if (guard !== null) clearTimeoutFn(guard);
            deps.win.removeEventListener('message', onMessage);
            try { frame?.remove(); } catch { /* already gone */ }
            resolve(result);
        };
        function onMessage(event) {
            if (event.origin !== deps.childOrigin || !frame || event.source !== frame.contentWindow) return;
            const parsed = parseHostMessage(event.data);
            if (parsed.ok && parsed.msg.type === 'host:cleaned') done({ ok: parsed.msg.ok, reason: parsed.msg.reason });
        }
        try {
            frame = deps.createFrame(deps.childOrigin + '/purge.html');
        } catch {
            resolve({ ok: false, reason: 'no-frame' });
            return;
        }
        deps.win.addEventListener('message', onMessage);
        // The page's script may not be listening yet: repeat the request until it answers.
        timer = setIntervalFn(() => {
            try { frame.contentWindow?.postMessage(buildMessage('app:cleanup'), deps.childOrigin); } catch { /* retry */ }
        }, HELLO_EVERY_MS);
        guard = setTimeoutFn(() => done({ ok: false, reason: 'timeout' }), deps.timeoutMs ?? PURGE_TIMEOUT_MS);
    });
}
