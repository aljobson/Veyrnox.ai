import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import OAuthConsent from '../src/app/(app)/oauth-consent';
import DeleteAccount from '../src/app/(app)/delete-account';
import { LOCALE_CODES, setLocaleFromDevice } from '../src/lib/i18n';
import { english, WEBSITE_BINDING_ENGLISH_KEYS } from '../src/lib/i18n/binding';

const mockApi = {};
let mockPublish = false;
const mockToken = async () => 'token';
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: mockToken }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({}), useLocalSearchParams: () => ({ authorization_id: 'request-id' }) }));
jest.mock('../src/lib/oauthConsent', () => ({
    ...jest.requireActual('../src/lib/oauthConsent'),
    fetchRequest: async () => ({ name: 'Assistant', scopes: [], publish: mockPublish }),
}));
jest.mock('../src/lib/accountDeletion', () => ({
    ...jest.requireActual('../src/lib/accountDeletion'),
    prepareDeletion: async () => ({ kind: 'ready', token: 'delete-token', forfeit: { credits: 0, freeCredits: 0 } }),
}));
void [RN.ActivityIndicator, RN.ScrollView, RN.Pressable, RN.Text, RN.TextInput, RN.View];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });
for (const locale of LOCALE_CODES) {
    test.each([false, true])(`${locale}: OAuth disclosures remain English with publish=%s`, async publish => {
        mockPublish = publish;
        setLocaleFromDevice([locale]);
        await act(async () => root.render(<OAuthConsent />));
        const omitted = publish ? ['oauth.summary', 'oauth.restrictions'] : ['oauth.summaryPublish', 'oauth.restrictionsPublish', 'oauth.publishAccess'];
        for (const key of WEBSITE_BINDING_ENGLISH_KEYS.filter(key => !omitted.includes(key))) {
            expect(root.container.queryAll(node => node.props.accessibilityLanguage === 'en' && textOf(node).includes(english(key))).length).toBeGreaterThan(0);
        }
    });
    test(`${locale}: deletion retention disclosure remains English beside typed confirmation`, async () => {
        setLocaleFromDevice([locale]);
        await act(async () => root.render(<DeleteAccount />));
        expect(root.container.queryAll(node => node.props.accessibilityLanguage === 'en' && textOf(node) === english('deleteaccount.thiserasesyouraccountandwhatis')).length).toBeGreaterThan(0);
        expect(root.container.queryAll(node => node.props.placeholder === 'DELETE').length).toBeGreaterThan(0);
        expect(root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityState?.disabled === true).length).toBeGreaterThan(0);
    });
}
