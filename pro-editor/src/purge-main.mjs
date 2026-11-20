// Browser entry of purge.html (no inline script; allowed parents come from a <meta>).
import { createPurger } from './purgeCore.mjs';
import { parseAllowedParents } from './protocol.mjs';

const status = document.getElementById('status');
const allowedParents = parseAllowedParents(
  document.querySelector('meta[name="pro-allowed-parents"]')?.getAttribute('content') || '',
);

if (window.parent === window || allowedParents.length === 0) {
  if (status) status.textContent = 'Not available.';
} else {
  const purger = createPurger({
    allowedParents,
    parentWindow: window.parent,
    ancestorOrigins: window.location.ancestorOrigins ? Array.from(window.location.ancestorOrigins) : null,
    locks: navigator.locks,
    getRoot: () => navigator.storage.getDirectory(),
    storage: window.localStorage,
    postToParent: (msg, origin) => window.parent.postMessage(msg, origin),
  });
  window.addEventListener('message', (event) => {
    if (event.source === window.parent) purger.handleParentMessage({ origin: event.origin, source: event.source, data: event.data });
  });
  if (status) status.textContent = 'Ready.';
}
