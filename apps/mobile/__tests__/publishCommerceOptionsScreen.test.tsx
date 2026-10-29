import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import CommerceEdit from '../src/app/(app)/publish/commerce-edit';
import { formatNumber, t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, OTHER, buttons, field, input, press, textOf } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockBack = jest.fn();
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => null }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), useRouter: () => ({ back: mockBack }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.KeyboardAvoidingView];
let root: Root;
const stored = { id: ID, title: 'Print', source: 'manual', status: 'active', currency: 'GBP', price_cents: 2499, inventory_quantity: 4,
    variants: [{ title: 'A3', sku: 'P-A3', price_cents: 2499, inventory_quantity: 2 }], collections: ['Prints, Gifts'], discount: { type: 'percent', value: 1000 } };
const page = (over = {}, brandRole = 'editor') => ({ brandRole, products: [{ ...stored, ...over }] });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); root = createRoot();
    mockRequest.mockImplementation(async (_path, init) => init?.method === 'PUT' ? {} : page());
});
afterEach(async () => { await act(async () => root.unmount()); brandStore.set(null); });
const render = async () => { await act(async () => root.render(<CommerceEdit />)); };
const label = (key: string, number: number) => t(`commerce.${key}`, { number: formatNumber(number) });
const puts = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT');
const saved = () => { expect(puts()).toHaveLength(1); return JSON.parse(puts()[0][1].body); };
const radio = async (key: string) => {
    const nodes = root.container.queryAll(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === t(key));
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
};
const readOnly = () => {
    for (const key of ['save', 'addOption', 'addCollection', 'removeOption']) expect(buttons(root, t(`commerce.${key}`))).toHaveLength(0);
    for (const node of root.container.queryAll(n => typeof n.props.onChangeText === 'function')) expect(node.props.editable).toBe(false);
    const radios = root.container.queryAll(n => n.props.accessibilityRole === 'radio'); expect(radios).toHaveLength(3);
    for (const node of radios) expect(node.props.accessibilityState.disabled).toBe(true);
};
test('an editor adds, edits and removes an option and the PUT carries it', async () => {
    await render(); await press(root, t('commerce.addOption'));
    expect(field(root, label('optionPriceLabel', 2)).props.value).toBe('24.99');
    await input(root, label('optionNameLabel', 2), 'A2'); await input(root, label('optionSkuLabel', 2), 'P-A2');
    await input(root, label('optionPriceLabel', 2), '35'); await input(root, label('optionStockLabel', 2), '3');
    await press(root, label('removeOptionLabel', 1)); await press(root, t('commerce.save'));
    expect(saved().variants).toEqual([{ title: 'A2', sku: 'P-A2', priceCents: 3500, inventoryQuantity: 3 }]);
});
test('an editor adds and removes collections and a percent discount and the PUT carries them', async () => {
    await render(); await press(root, t('commerce.addCollection')); await input(root, label('collectionNameLabel', 2), ' Sale ');
    await press(root, label('removeCollectionLabel', 1)); await radio('commerce.noDiscount');
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('commerce.discountPercent'))).toHaveLength(0);
    await radio('commerce.percentOff'); await input(root, t('commerce.discountPercent'), '12,5'); await press(root, t('commerce.save'));
    expect(saved()).toMatchObject({ collections: ['Sale'], discount: { type: 'percent', value: 1250 } });
});
test('changing the price keeps a stored collection with a comma unchanged', async () => {
    await render(); await input(root, t('commerce.price'), '30'); await press(root, t('commerce.save'));
    expect(saved().collections).toEqual(['Prints, Gifts']);
});
test('switching the discount type clears its value', async () => {
    await render(); expect(field(root, t('commerce.discountPercent')).props.value).toBe('10.00');
    await radio('commerce.amountOff'); expect(field(root, t('commerce.discountAmount')).props.value).toBe('');
    await input(root, t('commerce.discountAmount'), '4.99'); await radio('commerce.percentOff');
    expect(field(root, t('commerce.discountPercent')).props.value).toBe('');
});
test('a viewer sees options read-only with no add, remove or discount controls', async () => {
    mockRequest.mockResolvedValue(page({}, 'viewer')); await render(); readOnly();
    expect(field(root, label('optionNameLabel', 1)).props.value).toBe('A3'); expect(puts()).toHaveLength(0);
});
test('a shop-synced product shows its options read-only', async () => {
    mockRequest.mockResolvedValue(page({ source: 'shopify' })); await render(); readOnly();
    expect(field(root, label('optionNameLabel', 1)).props.value).toBe('A3');
});
test('a stored option the app cannot read leaves the product read-only with the unreadable message', async () => {
    mockRequest.mockResolvedValue(page({ variants: [{ title: 'A3', price_cents: 'bad', inventory_quantity: 2 }] }));
    await render(); readOnly(); expect(textOf(root.container)).toContain(t('commerce.err.optionsUnreadable')); expect(puts()).toHaveLength(0);
});
test('a brand switch clears an unsaved option draft', async () => {
    await render(); await press(root, t('commerce.addOption')); await input(root, label('optionNameLabel', 2), 'Unsaved A2');
    await act(async () => brandStore.set(OTHER));
    expect(root.container.queryAll(n => n.props.value === 'Unsaved A2')).toHaveLength(0);
    expect(field(root, label('optionNameLabel', 1)).props.value).toBe('A3'); expect(puts()).toHaveLength(0);
});
test('an invalid option shows its message and sends nothing', async () => {
    await render(); await press(root, t('commerce.addOption')); await press(root, t('commerce.save'));
    expect(textOf(root.container)).toContain(t('commerce.err.optionTitle')); expect(puts()).toHaveLength(0);
});
test('an oversized product shows the too-large message and sends nothing', async () => {
    mockRequest.mockResolvedValue(page({ variants: Array(100).fill({ title: '中'.repeat(120), sku: '中'.repeat(100), price_cents: 2499, inventory_quantity: 2 }) }));
    await render(); expect(buttons(root, t('commerce.addOption'))).toHaveLength(0); await press(root, t('commerce.save'));
    expect(textOf(root.container)).toContain(t('commerce.err.tooLarge')); expect(puts()).toHaveLength(0);
});
