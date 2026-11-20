import { ODDLINGS } from '../src/lib/oddlings';
import { puppetRig, ODDLING_PUPPET_RIGS } from '../../../app/veyrnox/_lib/oddlingPuppetRigs.js';
import { preparePuppetPixels } from '../../../app/veyrnox/_lib/oddlingPuppetRenderer.js';
import { preparePuppetPixelsBatched, type PuppetRig } from '../src/lib/oddlings/puppetPrepare';
import { puppetMask } from '../src/lib/oddlings/puppetNative';
jest.mock('@shopify/react-native-skia', () => require('@shopify/react-native-skia/lib/commonjs/skia/types'));
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
let Skia: any;
beforeAll(async () => {
    ({ Skia } = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(await CanvasKitInit({})));
});
const source = { width: 1024, height: 1536, data: new Uint8Array(1024 * 1536 * 4) };
// Vary rows, columns and channels, including near-background and high-contrast pixels.
for (let y = 0; y < 1536; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    source.data[i] = (x * 3 + y) % 256;
    source.data[i + 1] = (x + y * 7) % 256;
    source.data[i + 2] = (x ^ y) % 256;
    source.data[i + 3] = 255;
}
const area = (rig: PuppetRig) => {
    const xs = rig.head.map(p => p[0]), ys = rig.head.map(p => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};
const largest = Object.entries(ODDLING_PUPPET_RIGS).sort((a, b) => area(b[1]) - area(a[1]))[0];
const ids = [...new Set([...ODDLINGS.map(o => o.id), largest[0]])];
test.each(ids)('batched pixels and lids exactly match the web using the real %s polygon', async id => {
    const rig = puppetRig(id)!;
    const mask = puppetMask(Skia, rig);
    const expected = preparePuppetPixels(source, mask, rig);
    const batches: number[] = [];
    const began = performance.now();
    const actual = await preparePuppetPixelsBatched(source, mask, rig, { onBatch: ms => batches.push(ms) });
    const elapsed = performance.now() - began;
    // Buffer.equals avoids millions of per-byte Jest assertions while still comparing every byte.
    expect(Buffer.from(actual.plate).equals(Buffer.from(expected.plate))).toBe(true);
    expect(Buffer.from(actual.head).equals(Buffer.from(expected.head))).toBe(true);
    expect(actual.lids).toEqual(expected.lids);
    if (id === largest[0]) {
        console.info(`Largest rig ${id}: wall ${elapsed.toFixed(2)} ms; longest batch ${Math.max(...batches).toFixed(2)} ms; ${batches.length} batches`);
        expect(Math.max(...batches)).toBeLessThan(16);
    }
}, 30000);

test('abort is observed at the next elapsed-time yield', async () => {
    const controller = new AbortController();
    let yields = 0, clock = 0;
    const now = performance.now;
    performance.now = () => (clock += 8);
    try {
        await expect(preparePuppetPixelsBatched(source, new Uint8Array(source.data.length), puppetRig(ids[0])!, {
            signal: controller.signal,
            yieldTask: async () => { yields++; controller.abort(); },
        })).rejects.toThrow('puppet_aborted');
        expect(yields).toBe(1);
    } finally { performance.now = now; }
});

test.each([0, 16])('largest rig uses few yields with %s ms injected timer latency', async delay => {
    const rig = largest[1], mask = puppetMask(Skia, rig);
    const expected = preparePuppetPixels(source, mask, rig);
    let yields = 0;
    const batches: number[] = [];
    const began = performance.now();
    const actual = await preparePuppetPixelsBatched(source, mask, rig, {
        onBatch: ms => batches.push(ms),
        yieldTask: async () => {
            yields++;
            if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
        },
    });
    const wall = performance.now() - began;
    process.stdout.write(`Largest rig ${largest[0]}, injected yield ${delay} ms: ${yields} yields, wall ${wall.toFixed(2)} ms, longest batch ${Math.max(...batches).toFixed(2)} ms\n`);
    expect(yields).toBeLessThan(20);
    expect(Math.max(...batches)).toBeLessThan(16);
    expect(Buffer.from(actual.plate).equals(Buffer.from(expected.plate))).toBe(true);
    expect(Buffer.from(actual.head).equals(Buffer.from(expected.head))).toBe(true);
    expect(actual.lids).toEqual(expected.lids);
}, 30000);
