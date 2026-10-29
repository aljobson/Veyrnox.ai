import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Commerce from '../src/app/(app)/publish/commerce';
import CommerceEdit from '../src/app/(app)/publish/commerce-edit';
import { formatNumber, t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import { ID, buttons, field, press } from './publishDepthTestHelpers';
const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockPush = jest.fn(), mockTitle = jest.fn();
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => null }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: (props: any) => { mockTitle(props.options.title); return null; } }, useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), useRouter: () => ({ push: mockPush }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl, RN.KeyboardAvoidingView];
let root: Root, alert: jest.SpyInstance;
const page = (brandRole = 'editor', source = 'manual', status = 'active') => ({ brandRole, products: [{ id: ID, title: 'Print', source, status, currency: 'GBP', price_cents: 2499, inventory_quantity: 4,
    variants: [{ title: 'A3', sku: 'P-A3', price_cents: 2499, inventory_quantity: 2 }], collections: ['Prints'], discount: null }] });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(ID); jest.clearAllMocks(); root = createRoot();
    mockRequest.mockResolvedValue(page()); alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
const render = async () => { await act(async () => root.render(<Commerce />)); };
const opened = () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/publish/commerce-edit', params: { id: ID } });
test('a viewer can open a product read-only from the list', async () => {
    mockRequest.mockResolvedValue(page('viewer')); await render();
    for (const key of ['edit', 'archive']) expect(buttons(root, t(`commerce.${key}`))).toHaveLength(0);
    await press(root, t('commerce.view')); opened();
    await act(async () => root.render(<CommerceEdit />));
    expect(mockTitle).toHaveBeenLastCalledWith(t('commerce.view'));
    expect(field(root, t('commerce.optionNameLabel', { number: formatNumber(1) })).props).toMatchObject({ value: 'A3', editable: false });
    for (const key of ['save', 'addOption']) expect(buttons(root, t(`commerce.${key}`))).toHaveLength(0);
});
test('a shop-synced product offers View, not Edit, to an editor', async () => {
    mockRequest.mockResolvedValue(page('editor', 'shopify')); await render();
    expect(buttons(root, t('commerce.edit'))).toHaveLength(0); expect(buttons(root, t('commerce.archive'))).toHaveLength(1);
    await press(root, t('commerce.view')); opened();
});
test('an editable product offers Edit to an editor, as before', async () => {
    await render(); expect(buttons(root, t('commerce.view'))).toHaveLength(0);
    await press(root, t('commerce.edit')); opened();
});
test.each([['editor', 'manual'], ['editor', 'shopify'], ['viewer', 'manual']])('the card summary and its buttons are separate accessibility elements (%s, %s)', async (role, source) => {
    mockRequest.mockResolvedValue(page(role, source)); await render();
    const summaries = root.container.queryAll(n => n.props.testID === `commerce-summary-${ID}`);
    expect(summaries).toHaveLength(1); const summary = summaries[0];
    expect(summary.props.accessible).toBe(true); expect(summary.props.accessibilityLabel).toContain('Print');
    expect(summary.props.accessibilityLabel).toContain(t('commerce.stock', { count: 4 }));
    expect(summary.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
    const keys = [role === 'editor' && source === 'manual' ? 'edit' : 'view', ...(role === 'editor' ? ['archive'] : [])];
    for (const key of keys) {
        const matches = buttons(root, t(`commerce.${key}`)); expect(matches).toHaveLength(1);
        let node = matches[0].parent; let foundCard = false;
        while (node) { expect(node.props.accessible).not.toBe(true); if (node.props.accessible === false) foundCard = true; node = node.parent; }
        expect(foundCard).toBe(true); await press(root, t(`commerce.${key}`));
    }
    opened(); if (role === 'editor') expect(alert).toHaveBeenCalledTimes(1);
});
test('archived products offer View without Archive', async () => {
    mockRequest.mockResolvedValue(page('editor', 'manual', 'archived')); await render();
    expect(buttons(root, t('commerce.archive'))).toHaveLength(0); expect(buttons(root, t('commerce.edit'))).toHaveLength(0);
    await press(root, t('commerce.view')); opened();
});
