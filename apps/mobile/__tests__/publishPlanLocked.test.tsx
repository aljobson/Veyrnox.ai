import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Contacts from '../src/app/(app)/publish/contacts';
import Smartlink from '../src/app/(app)/publish/smartlink';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
import { PLAN_LOCK_KEYS, isPlanLockKey, isPlanLockMessage } from '../src/lib/publishPlanLocked';
import { buttons } from './publishDepthTestHelpers';

const mockRequest = jest.fn(), mockApi = { request: mockRequest }, mockPush = jest.fn(), mockTitle = jest.fn();
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/lib/usePublishRole', () => ({ usePublishRole: () => 'owner', publishScope: () => 's' }));
jest.mock('expo-router', () => ({ Stack: { Screen: (props: any) => { mockTitle(props.options.title); return null; } }, useRouter: () => ({ push: mockPush }), useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'u', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.FlatList, RN.RefreshControl, RN.KeyboardAvoidingView];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); mockRequest.mockRejectedValue(new ApiError(402, 'plan_required')); });
afterEach(async () => { await act(async () => root.unmount()); });

test('plan keys are recognised by key and by translated message', () => {
    expect(isPlanLockKey('contacts.err.plan')).toBe(true);
    expect(isPlanLockKey('contacts.err.network')).toBe(false);
    for (const key of PLAN_LOCK_KEYS) expect(isPlanLockMessage(t(key))).toBe(true);
    expect(isPlanLockMessage(null)).toBe(false);
});
test('contacts on a brand without the plan hides its controls and offers the plan, not Try again', async () => {
    await act(async () => root.render(<Contacts />));
    expect(buttons(root, t('publishParity.plan.see'))).toHaveLength(1);
    expect(buttons(root, t('publishHome.retry'))).toHaveLength(0);
    expect(buttons(root, t('publishOps.import.title'))).toHaveLength(0);
    expect(root.container.queryAll((n) => n.props.placeholder === t('contacts.search'))).toHaveLength(0);
});
test('smartlink has its title from the first frame and a way to the plan', async () => {
    await act(async () => root.render(<Smartlink />));
    expect(mockTitle.mock.calls[0][0]).toBe(t('smartlink.title'));
    expect(buttons(root, t('publishParity.plan.see'))).toHaveLength(1);
});
