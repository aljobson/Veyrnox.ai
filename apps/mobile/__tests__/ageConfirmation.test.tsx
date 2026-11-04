import { act } from 'react';
import { Text } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useAuth } from '../src/auth/AuthProvider';
import { AgeConfirmationGate } from '../src/components/account/AgeConfirmationGate';
import { AGE_CONFIRMATION_VERSION, ageCheckFrom, confirmAge } from '../src/lib/ageConfirmation';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }), { virtual: true });

describe('what the server says', () => {
    test('only an explicit true asks; anything unclear never blocks', () => {
        expect(ageCheckFrom({ age_confirmation_required: true })).toBe('ask');
        expect(ageCheckFrom({ age_confirmation_required: false })).toBe('confirmed');
        expect(ageCheckFrom({ age_confirmed: true })).toBe('confirmed');
        expect(ageCheckFrom({})).toBe('unknown');
        expect(ageCheckFrom(null)).toBe('unknown');
    });
    test('confirming sends the fixed statement version and needs age_confirmed back', async () => {
        const request = jest.fn(async () => ({ age_confirmed: true }));
        await confirmAge({ request } as never);
        expect(request).toHaveBeenCalledWith('/api/v1/account/age-confirmation', expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirm: true, version: AGE_CONFIRMATION_VERSION }) }));
        await expect(confirmAge({ request: jest.fn(async () => ({})) } as never)).rejects.toBeInstanceOf(ApiError);
    });
});

describe('the gate', () => {
    let root: Root;
    beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
    afterEach(async () => { await act(async () => root.unmount()); });
    const press = (label: string) => act(async () => root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onClick)[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const mount = async (request: jest.Mock) => {
        jest.mocked(useAuth).mockReturnValue({ api: { request }, signOut: jest.fn() } as any);
        await act(async () => root.render(<AgeConfirmationGate><Text>Inside</Text></AgeConfirmationGate>));
    };
    test('flag off: the app is never covered and nothing is posted', async () => {
        const request = jest.fn(async () => ({ age_confirmation_required: false }));
        await mount(request);
        expect(root.container.queryAll(n => n.children.includes(t('app.age.title')))).toHaveLength(0);
        expect(request).toHaveBeenCalledTimes(1);
    });
    test('asks, then confirming posts once and opens', async () => {
        const request = jest.fn(async (path: string) => (path === '/api/v1/account' ? { age_confirmation_required: true } : { age_confirmed: true }));
        await mount(request);
        expect(root.container.queryAll(n => n.children.includes(t('app.age.title'))).length).toBeGreaterThan(0);
        await act(async () => root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        await press(t('app.age.continue'));
        expect(request).toHaveBeenCalledWith('/api/v1/account/age-confirmation', expect.anything());
        expect(root.container.queryAll(n => n.children.includes(t('app.age.title')))).toHaveLength(0);
    });
    test('declining sends nothing and offers sign out', async () => {
        const request = jest.fn(async () => ({ age_confirmation_required: true }));
        await mount(request);
        await press(t('app.age.decline', { age: 18 }));
        expect(root.container.queryAll(n => n.children.includes(t('app.age.declined'))).length).toBeGreaterThan(0);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
