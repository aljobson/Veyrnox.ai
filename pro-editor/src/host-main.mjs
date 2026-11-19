// Browser entry of host.html: wires the real window, locks, OPFS and storage into hostCore.
// The page contains no inline script; the allowed parent origins come from a <meta> that the
// build writes (exact origins, comma separated).

import { createHost } from './hostCore.mjs';
import { parseAllowedParents, transferList } from './protocol.mjs';

const statusEl = document.getElementById('status');
const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };

const allowedParents = parseAllowedParents(
  document.querySelector('meta[name="pro-allowed-parents"]')?.getAttribute('content') || '',
);

function refuse(text) {
  setStatus(text);
}

if (window.parent === window) {
  refuse('Open this editor from the Veyrnox.ai Pro editor.');
} else if (allowedParents.length === 0) {
  refuse('The Pro editor is not configured.');
} else {
  const selfOrigin = window.location.origin;
  const frameHolder = document.getElementById('editor');
  let innerFrame = null;

  const host = createHost({
    selfOrigin,
    allowedParents,
    parentWindow: window.parent,
    ancestorOrigins: window.location.ancestorOrigins ? Array.from(window.location.ancestorOrigins) : null,
    locks: navigator.locks,
    getRoot: () => navigator.storage.getDirectory(),
    storage: window.localStorage,
    crypto: window.crypto,
    createInner({ renderer, nonce }) {
      const frame = document.createElement('iframe');
      const params = new URLSearchParams({ host: 'parent', hn: nonce });
      if (renderer === 'webgl') params.set('webgl', '');
      frame.src = './fc/index.html?' + params.toString().replace(/=(&|$)/g, '$1');
      frame.title = 'Pro editor';
      frame.allow = 'fullscreen; clipboard-read; clipboard-write';
      frame.setAttribute('allowfullscreen', '');
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0';
      frameHolder.appendChild(frame);
      innerFrame = frame;
      return {
        get contentWindow() { return frame.contentWindow; },
        destroy() { frame.remove(); if (innerFrame === frame) innerFrame = null; },
      };
    },
    postToParent(msg, targetOrigin) {
      window.parent.postMessage(msg, targetOrigin, transferList(msg));
    },
    postToInner(msg, targetOrigin) {
      if (innerFrame && innerFrame.contentWindow) innerFrame.contentWindow.postMessage(msg, targetOrigin, transferList(msg));
    },
  });

  // The gate reads this from the inner frame. Only `consume` is exposed, nothing else.
  Object.defineProperty(window, '__proHost', {
    value: Object.freeze({ consume: (nonce) => host.consume(nonce) }),
    writable: false,
    configurable: false,
    enumerable: false,
  });

  window.addEventListener('message', (event) => {
    if (event.source === window.parent) host.handleParentMessage({ origin: event.origin, source: event.source, data: event.data });
    else host.handleInnerMessage({ origin: event.origin, source: event.source, data: event.data });
  });
  setStatus('Waiting for the Veyrnox.ai Pro editor…');
}
