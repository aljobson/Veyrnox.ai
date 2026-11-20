import { randomUUID } from 'expo-crypto';
// Hermes does not guarantee crypto.randomUUID. The shared recorder needs it at runtime.
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { ...globalThis.crypto, randomUUID } });
// RN exposes `window` as globalThis without DOM events. instrumentTakeDb installs one
// pagehide listener at import time. Its IndexedDB adapter is replaced before use; native
// lifecycle finalization is handled by AppState, so this unused browser listener is a no-op.
if (typeof window !== 'undefined' && typeof window.addEventListener !== 'function') {
    Object.defineProperty(window, 'addEventListener', { configurable: true, value: () => {} });
}
