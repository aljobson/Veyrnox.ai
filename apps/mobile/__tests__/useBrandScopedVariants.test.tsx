import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { brandStore } from '../src/lib/publishBrand';
import { useBrandScopedVariants } from '../src/lib/useBrandScopedVariants';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let root: Root;
let latest: ReturnType<typeof useBrandScopedVariants>;
function Probe() { latest = useBrandScopedVariants(); return null; }
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    brandStore.set(A);
    root = createRoot();
    await act(async () => { root.render(<Probe />); });
});
afterEach(async () => {
    await act(async () => root.unmount());
    brandStore.set(null);
});

test('switching brands clears typed variants and resets a refusal', async () => {
    await act(async () => latest.setNetworkText({ twitter: 'A text' }));
    expect(latest.networkText).toEqual({ twitter: 'A text' });
    await act(async () => latest.markOff(A));
    expect(latest.off).toBe(true);
    expect(latest.networkText).toEqual({});
    await act(async () => brandStore.set(B));
    expect(latest.off).toBe(false);
    expect(latest.networkText).toEqual({});
    await act(async () => latest.setNetworkText({ youtube: 'B text' }));
    await act(async () => brandStore.set(A));
    expect(latest.networkText).toEqual({});
});

test('late markOff(A) cannot disable B, while markOff(B) clears B text and disables variants', async () => {
    const late = latest.markOff;
    await act(async () => brandStore.set(B));
    await act(async () => latest.setNetworkText({ twitter: 'B text' }));
    await act(async () => late(A));
    expect(latest.off).toBe(false);
    expect(latest.networkText).toEqual({ twitter: 'B text' });
    await act(async () => latest.markOff(B));
    expect(latest.off).toBe(true);
    expect(latest.networkText).toEqual({});
});
