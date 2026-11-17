import test from 'node:test';
import assert from 'node:assert/strict';
import { openBeatCapture } from '../app/veyrnox/_lib/music/beat/beatCapture.js';
// A remembered input that was unplugged is refused by the browser with OverconstrainedError / NotFoundError.
for (const name of ['OverconstrainedError', 'NotFoundError']) {
  test(`${name} from a stored input names the problem instead of a raw browser message`, async t => {
    const saved = { document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), node: globalThis.AudioWorkletNode };
    globalThis.document = {}; globalThis.AudioWorkletNode = function () {};
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('raw'), { name }); } } } });
    t.after(() => { globalThis.document = saved.document; globalThis.AudioWorkletNode = saved.node; if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); });
    await assert.rejects(openBeatCapture({ audioWorklet: {} }, 'unplugged-mic'), /That microphone isn't available — choose another input/);
  });
}
