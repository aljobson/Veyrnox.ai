import { getObject, sha256Hex } from '../packages/adapters/r2.js';
import { readBoundedBody } from './boundedBody.js';
import { validTemplateSwapSource } from './templateSwapClipGeneration.js';

export const TEMPLATE_SWAP_MANIFEST_MAX_BYTES = 1024 * 1024;
const DEADLINE_MS = 3000;
const RETRY_MS = 10000;

// Each loader owns an isolate cache. Dependencies are injectable for offline proofs.
export function createTemplateSwapClipManifestLoader({ get = getObject, now = Date.now, timeoutMs = DEADLINE_MS,
  log = (...args) => console.error(...args) } = {}) {
  const cache = new Map();
  async function verify(pin, cfg) {
    const controller = new AbortController();
    let reason = 'pin', timer, abort;
    try {
      if (typeof pin !== 'string' || !/^[a-f0-9]{64}$/.test(pin)) throw Error();
      const aborted = new Promise((_, reject) => {
        abort = () => reject(Error('deadline'));
        controller.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { reason = 'timeout'; controller.abort(); }, timeoutMs);
      });
      const work = async () => {
        reason = 'r2';
        const result = await get(`template-swap-clips/manifests/${pin}.json`, cfg, { signal: controller.signal, logErrors: false });
        // A transport that ignores abort may eventually return; do not leave its body open.
        if (controller.signal.aborted || !result?.ok || result.response?.status !== 200) {
          void result?.response?.body?.cancel().catch(() => {});
          throw Error();
        }
        reason = 'body';
        const bytes = await readBoundedBody(result.response.body, TEMPLATE_SWAP_MANIFEST_MAX_BYTES, controller.signal);
        reason = 'hash';
        if (await sha256Hex(bytes) !== pin) throw Error();
        reason = 'json';
        const document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        reason = 'schema';
        if (document?.version !== 1 || !document.clips || typeof document.clips !== 'object' || Array.isArray(document.clips)) throw Error();
        for (const [id, entry] of Object.entries(document.clips)) {
          if (!validTemplateSwapSource(id, entry)) throw Error();
          Object.freeze(entry);
        }
        return Object.freeze(document.clips);
      };
      return await Promise.race([work(), aborted]);
    } catch {
      controller.abort();
      log('[template-swap] manifest unavailable', reason);
      return null;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort);
    }
  }
  return function load(pin, cfg) {
    const previous = cache.get(pin);
    if (previous && (previous.pending || previous.manifest || now() < previous.retryAt)) {
      return previous.pending ?? Promise.resolve(previous.manifest);
    }
    const entry = {};
    // Defer all async work until after the promise is installed (single flight).
    entry.pending = Promise.resolve().then(() => verify(pin, cfg)).then(manifest => {
      entry.manifest = manifest;
      entry.retryAt = manifest ? Infinity : now() + RETRY_MS;
      delete entry.pending;
      return manifest;
    });
    cache.set(pin, entry);
    return entry.pending;
  };
}

export const loadTemplateSwapClipManifest = createTemplateSwapClipManifestLoader();
