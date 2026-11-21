import { PURCHASE_VIEW_TAGS, purchaseActionPolicy, selectPurchaseViewState } from '../src/billing/purchaseViewState';
import type { PurchaseOperation, PurchaseOutcome } from '../src/billing/storePurchaseStore';

const operation = (phase: PurchaseOperation['phase'], outcome: PurchaseOutcome | null = null): PurchaseOperation => ({
    opId: 1, owner: 'buyer', phase, kind: null, productId: null, outcome,
});

test('the shared selector exposes every approved Wave 2D purchase state tag', () => {
    const states = [
        selectPurchaseViewState(operation('idle'), 'idle', true),
        selectPurchaseViewState(operation('idle'), 'loading', true),
        selectPurchaseViewState(operation('idle'), 'ready', true),
        selectPurchaseViewState(operation('preparing'), 'ready', true),
        selectPurchaseViewState(operation('store'), 'ready', true),
        selectPurchaseViewState(operation('confirming'), 'ready', true),
        ...([
            { kind: 'credited', balance: 10, credits: 10, price: '£1' }, { kind: 'subscribed' }, { kind: 'restored' },
            { kind: 'nothingToRestore' }, { kind: 'cancelled' }, { kind: 'pending' }, { kind: 'error' }, { kind: 'sales_closed' },
        ] as PurchaseOutcome[]).map(outcome => selectPurchaseViewState(operation('done', outcome), 'ready', true)),
    ];
    expect(states.map(state => state.tag)).toEqual(PURCHASE_VIEW_TAGS);
});

test('catalog failures and closed sales use recovery states before an operation starts', () => {
    expect(selectPurchaseViewState(operation('idle'), 'error', true).tag).toBe('error');
    expect(selectPurchaseViewState(operation('idle'), 'ready', false).tag).toBe('sales-closed');
});

test.each([
    ['loading', false, false, false, true],
    ['ready', true, true, false, true],
    ['preparing', false, false, false, true],
    ['store', false, false, false, false],
    ['confirming', false, false, false, true],
    ['pending', false, true, false, true],
    ['error', true, true, true, true],
    ['sales-closed', false, true, true, true],
] as const)('%s has one deterministic action policy', (tag, buy, restore, retry, close) => {
    const phase = tag === 'preparing' || tag === 'store' || tag === 'confirming' ? tag : 'done';
    const outcome = phase === 'done' ? ({ kind: tag === 'sales-closed' ? 'sales_closed' : tag } as PurchaseOutcome) : null;
    const state = tag === 'loading' || tag === 'ready'
        ? selectPurchaseViewState(operation('idle'), tag, true)
        : selectPurchaseViewState(operation(phase, outcome), 'ready', true);
    expect(purchaseActionPolicy(state)).toMatchObject({ buy, restore, manage: tag !== 'store', retry, close });
});
