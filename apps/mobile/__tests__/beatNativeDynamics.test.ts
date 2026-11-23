import { createDynamicsProcessor } from '../src/lib/beatNative/dynamicsProcessor';

const render = (processor: ReturnType<typeof createDynamicsProcessor>, left: Float32Array, right = left) => {
    const output = [new Float32Array(left.length), new Float32Array(left.length)];
    processor([left, right], output, 2, 2, left.length, 0);
    return output;
};

test('look-ahead envelope compression is time-domain, stereo-linked, and applies attack', () => {
    const fast = createDynamicsProcessor({ threshold: -12, knee: 0, ratio: 4, attack: 0, release: 0.1 }, 8_000);
    const slow = createDynamicsProcessor({ threshold: -12, knee: 0, ratio: 4, attack: 0.1, release: 0.1 }, 8_000);
    const input = new Float32Array(256).fill(1);
    const [fastLeft, fastRight] = render(fast, input, new Float32Array(256).fill(0.25));
    const [slowLeft] = render(slow, input);
    expect([...fastLeft.slice(0, 48)]).toEqual(new Array(48).fill(0));
    expect(fastLeft[80]).toBeLessThan(0.5);
    expect(fastRight[80] / fastLeft[80]).toBeCloseTo(0.25, 5);
    expect(slowLeft[80]).toBeGreaterThan(fastLeft[80]);
});

test('release state persists across render quanta and recovers gain gradually', () => {
    const processor = createDynamicsProcessor({ threshold: -18, knee: 0, ratio: 8, attack: 0, release: 0.05 }, 8_000);
    render(processor, new Float32Array(256).fill(1));
    const [first] = render(processor, new Float32Array(512).fill(0.2));
    expect(first[80]).toBeLessThan(first[500]);
    expect(first[500]).toBeLessThanOrEqual(0.2);
});

test('processor bounds sample rate, channel counts, and frames without per-render setup', () => {
    const processor = createDynamicsProcessor({ threshold: Number.NaN, ratio: 999 }, Number.POSITIVE_INFINITY);
    const input = new Float32Array(128).fill(0.5), output = [new Float32Array(128)];
    expect(() => processor([input], output, 99, 99, 128, 0)).not.toThrow();
    expect(output[0].every(Number.isFinite)).toBe(true);
});
