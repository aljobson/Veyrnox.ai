// Controller of purge.html: a wasm-free page on the child origin that wipes the origin's stored
// editor data and nothing else (plan rev 4/5). The parent app loads it after it removed the
// editor frame (sign-out, token expiry, account change) and removes it again when it answers or
// after its own timeout. It never starts FilmCraft and never holds the lock longer than the wipe.

import { buildMessage, isAllowedParentOrigin, parseAppMessage } from './protocol.mjs';
import { acquireSessionLock, purgeStorage } from './session.mjs';

/**
 * deps: allowedParents[], parentWindow, ancestorOrigins (array-like or null), locks, getRoot,
 *       storage, postToParent(msg, targetOrigin)
 */
export function createPurger(deps) {
  let busy = false;

  function reply(origin, ok, reason) {
    deps.postToParent(buildMessage('host:cleaned', { ok, reason }), origin);
  }

  async function run(origin) {
    const ancestors = deps.ancestorOrigins;
    if (ancestors && ancestors.length > 0 && !isAllowedParentOrigin(ancestors[0], deps.allowedParents)) {
      reply(origin, false, 'not-allowed');
      return;
    }
    // Same lock as the editor, ifAvailable: while an editor owns it, its own pre-start purge
    // guarantees a clean start for the next account, and we never steal or queue behind it.
    const lock = await acquireSessionLock(deps.locks);
    if (!lock.ok) { reply(origin, false, lock.reason); return; }
    try {
      const purge = await purgeStorage({ getRoot: deps.getRoot, storage: deps.storage });
      if (purge.ok) reply(origin, true, 'none');
      else reply(origin, false, 'purge-failed');
    } finally {
      lock.release();
    }
  }

  function handleParentMessage({ origin, source, data }) {
    if (source !== deps.parentWindow) return { ignored: 'source' };
    if (!isAllowedParentOrigin(origin, deps.allowedParents)) return { ignored: 'origin' };
    const parsed = parseAppMessage(data);
    if (!parsed.ok || parsed.msg.type !== 'app:cleanup') return { ignored: parsed.ok ? 'type' : parsed.reason };
    if (busy) return { ignored: 'busy' };
    busy = true;
    run(origin).finally(() => { busy = false; });
    return { handled: 'cleanup' };
  }

  return { handleParentMessage };
}
