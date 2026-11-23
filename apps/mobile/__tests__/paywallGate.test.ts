import { checkPaywallPurchase, parsePaywallOffering, paywallsEnabled, type PaywallGateDeps } from '../src/billing/paywallGate';

const pkg = (identifier: string) => ({ product: { identifier } }) as never;
const plan = pkg('ai.veyrnox.generation.plus.monthly');
const pack = pkg('ai.veyrnox.credits.300');

function deps(over: Partial<PaywallGateDeps> = {}) {
    const value: PaywallGateDeps = {
        canPurchase: true,
        generationActive: false,
        refreshSales: jest.fn(async () => true),
        refreshGenerationAccess: jest.fn(async () => false),
        ...over,
    };
    return { value };
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

test('a ready account with open sales may buy a pack', async () => {
    const { value } = deps();
    expect(await checkPaywallPurchase(pack, value)).toBe('ok');
    expect(value.refreshGenerationAccess).not.toHaveBeenCalled();
});

test('an account that is not bound to the store is refused without contacting the server', async () => {
    const { value } = deps({ canPurchase: false });
    expect(await checkPaywallPurchase(pack, value)).toBe('not_ready');
    expect(value.refreshSales).not.toHaveBeenCalled();
});

test('sales closed on a fresh read stops the purchase', async () => {
    const { value } = deps({ refreshSales: jest.fn(async () => false) });
    expect(await checkPaywallPurchase(pack, value)).toBe('sales_closed');
});

test('a plan is refused when a web or store plan is already active', async () => {
    const { value } = deps({ refreshGenerationAccess: jest.fn(async () => true) });
    expect(await checkPaywallPurchase(plan, value)).toBe('generation_already_active');
});

test('a plan fails closed when the existing plan cannot be checked', async () => {
    const { value } = deps({ refreshGenerationAccess: jest.fn(async () => { throw new Error('offline'); }) });
    expect(await checkPaywallPurchase(plan, value)).toBe('not_ready');
});

test('a retired package is refused before taking a lock or contacting the store', async () => {
    for (const id of ['ai.veyrnox.generation.ultra.monthly', 'ai.veyrnox.generation.ultra.annual:annual']) {
        const { value } = deps();
        expect(await checkPaywallPurchase(pkg(id), value)).toBe('not_ready');
        expect(value.refreshSales).not.toHaveBeenCalled();
    }
});
