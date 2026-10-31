import { checkPaywallPurchase, parsePaywallOffering, paywallsEnabled, type PaywallGateDeps } from '../src/billing/paywallGate';

const pkg = (identifier: string) => ({ product: { identifier } }) as never;
const plan = pkg('ai.veyrnox.generation.plus.monthly');
const pack = pkg('ai.veyrnox.credits.300');

function deps(over: Partial<PaywallGateDeps> = {}) {
    const release = jest.fn();
    const value: PaywallGateDeps = {
        canPurchase: true,
        generationActive: false,
        acquireLock: jest.fn(() => release),
        refreshSales: jest.fn(async () => true),
        refreshGenerationAccess: jest.fn(async () => false),
        ...over,
    };
    return { value, release };
}

test('the switch is on only for the exact word true', () => {
    expect(paywallsEnabled('true')).toBe(true);
    expect(paywallsEnabled('1')).toBe(false);
    expect(paywallsEnabled(undefined)).toBe(false);
});

test('only the three known offerings can be opened', () => {
    expect(parsePaywallOffering('generation')).toBe('generation');
    expect(parsePaywallOffering('publish')).toBe('publish');
    expect(parsePaywallOffering('ultra')).toBeNull();
    expect(parsePaywallOffering(['credits'])).toBeNull();
});

test('a ready account with open sales may buy a pack and keeps the lock until the purchase ends', async () => {
    const { value, release } = deps();
    const gate = await checkPaywallPurchase(pack, value);
    expect(gate.result).toBe('ok');
    expect(value.refreshGenerationAccess).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    gate.release();
    expect(release).toHaveBeenCalledTimes(1);
});

test('an account that is not bound to the store is refused without taking the lock', async () => {
    const { value } = deps({ canPurchase: false });
    expect((await checkPaywallPurchase(pack, value)).result).toBe('not_ready');
    expect(value.acquireLock).not.toHaveBeenCalled();
});

test('another purchase in progress blocks the paywall', async () => {
    const { value } = deps({ acquireLock: jest.fn(() => null) });
    expect((await checkPaywallPurchase(pack, value)).result).toBe('busy');
    expect(value.refreshSales).not.toHaveBeenCalled();
});

test('sales closed on a fresh read stops the purchase and frees the lock', async () => {
    const { value, release } = deps({ refreshSales: jest.fn(async () => false) });
    expect((await checkPaywallPurchase(pack, value)).result).toBe('sales_closed');
    expect(release).toHaveBeenCalledTimes(1);
});

test('a plan is refused when a web or store plan is already active', async () => {
    const { value, release } = deps({ refreshGenerationAccess: jest.fn(async () => true) });
    expect((await checkPaywallPurchase(plan, value)).result).toBe('generation_already_active');
    expect(release).toHaveBeenCalledTimes(1);
});

test('a plan fails closed when the existing plan cannot be checked', async () => {
    const { value, release } = deps({ refreshGenerationAccess: jest.fn(async () => { throw new Error('offline'); }) });
    expect((await checkPaywallPurchase(plan, value)).result).toBe('not_ready');
    expect(release).toHaveBeenCalledTimes(1);
});
