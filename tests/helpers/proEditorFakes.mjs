// Fakes for the Pro editor host tests: Web Locks, OPFS root, localStorage, a frame and windows.

export function createFakeLocks() {
  const held = new Set();
  return {
    async request(name, options, callback) {
      if (options && options.ifAvailable && held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
    isHeld(name) { return held.has(name); },
  };
}

export function createFakeOpfs(files = {}, { failRemove = false } = {}) {
  const top = new Map();
  for (const path of Object.keys(files)) top.set(path.split('/')[0], true);
  const root = {
    async *entries() { for (const name of [...top.keys()]) yield [name, {}]; },
    async removeEntry(name) {
      if (failRemove) throw new Error('quota or lock error');
      top.delete(name);
    },
    // Test hook: simulate the engine writing after a purge.
    write(path) { top.set(path.split('/')[0], true); },
  };
  return { root, names: () => [...top.keys()] };
}

export function createFakeStorage(initial = {}, { failSet = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (failSet) throw new Error('storage disabled'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

export const deterministicCrypto = (() => {
  let n = 1;
  return {
    getRandomValues(buf) {
      for (let i = 0; i < buf.length; i += 1) { buf[i] = (n * 31 + i * 7) % 256; n += 1; }
      return buf;
    },
  };
})();

/** A window-like object for the gate tests. */
export function createFakeWindow({ origin = 'https://pro.example', parentOrigin = origin, host, search = '', framed = true, throwOnParentLocation = false } = {}) {
  const win = {
    location: { origin, search, pathname: '/fc/index.html', hash: '' },
    history: { replaced: [], replaceState(_s, _t, url) { this.replaced.push(url); } },
  };
  if (!framed) {
    win.parent = win;
    return win;
  }
  const parent = {
    __proHost: host,
  };
  Object.defineProperty(parent, 'location', {
    get() {
      if (throwOnParentLocation) throw new DOMException('cross-origin', 'SecurityError');
      return { origin: parentOrigin };
    },
  });
  win.parent = parent;
  return win;
}
