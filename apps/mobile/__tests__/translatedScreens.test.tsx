import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { LanguageChoice } from '../src/components/LanguageChoice';
import SignIn from '../src/app/sign-in';
import Home from '../src/app/(app)/(tabs)/index';
import Create from '../src/app/(app)/(tabs)/create';
import Credits from '../src/app/(app)/credits';
import Publish from '../src/app/(app)/(tabs)/publish';
import { UnlockCard } from '../src/components/UnlockCard';
import { ConsentRow } from '../src/components/ui/ConsentRow';
import { aiConsent } from '../src/lib/aiConsentStore';
import { AiConsentHost } from '../src/components/AiConsentHost';
import { SubmitPanel } from '../src/components/cinema/creator/SubmitPanel';
import { RIGHTS_TEXT, SAFETY_TEXT, MALWARE_TEXT } from '../src/lib/cinemaDrafts';
import { APP_CATALOGS, CATALOGS, getLocale, setLocaleFromDevice, t, type LocaleCode } from '../src/lib/i18n';
import { english, BINDING_ENGLISH_KEYS } from '../src/lib/i18n/binding';
import { renewalTerms } from '../src/lib/billing';
import en from '../src/lib/i18n/messages/en';
import webKeys from '../src/lib/i18n/webKeys.json';

declare const require: (id: string) => any;
const mockApi = { request: jest.fn(async () => ({})), getBalance: async () => ({ balance: 100 }) };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
const mockPackages = (product: string) => [{ identifier: product, product: { identifier: product, title: 'Store product', priceString: '9,99 €' } }];
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedOut', api: mockApi, canReloadSession: () => true }) }));
jest.mock('../src/billing/BillingProvider', () => ({ useBilling: () => ({ status: 'ready', canPurchase: true, generationActive: false, generationChecked: true, publishActive: false, offerings: { all: {
    generation: { availablePackages: mockPackages('ai.veyrnox.generation.starter.monthly') },
    publish: { availablePackages: mockPackages('ai.veyrnox.publish.annual') },
} }, purchase: jest.fn(), restore: jest.fn() }) }));
jest.mock('../src/lib/i18n', () => {
    const actual = jest.requireActual('../src/lib/i18n');
    actual.setLocaleFromDevice(['de']); // Initialize before modules capture startup translations.
    const calls: { key: string; locale: string; plural: boolean }[] = [];
    return { ...actual, __calls: calls,
        t: (key: string, vars: any) => { calls.push({ key, locale: actual.getLocale(), plural: false }); return actual.t(key, vars); },
        plural: (key: string, count: number, vars: any) => { calls.push({ key, locale: actual.getLocale(), plural: true }); return actual.plural(key, count, vars); },
    };
});
jest.mock('expo', () => ({ ...jest.requireActual('expo'), reloadAppAsync: jest.fn() }));
jest.mock('expo-router', () => ({
    Link: ({ children }: any) => children, Stack: { Screen: () => null }, Redirect: () => null,
    useRouter: () => mockRouter, useLocalSearchParams: () => ({}), usePathname: () => '/',
    useFocusEffect: (fn: any) => require('react').useEffect(fn, [fn]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }), SafeAreaView: require('react-native').View }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (callback: any) => { callback([]); return []; }, mediaApi: () => ({ listJobs: async () => ({ jobs: [] }) }) }));
jest.mock('../src/lib/presets', () => ({ ...jest.requireActual('../src/lib/presets'), fetchPresets: async () => [] }));
jest.mock('../src/lib/montage', () => ({ ...jest.requireActual('../src/lib/montage'), fetchAgentListing: async () => null }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/useFreeLeft', () => ({ useFreeLeft: () => ({}) }));
jest.mock('../src/lib/useFaceFiltersAvailable', () => ({ useFaceFiltersAvailable: () => false }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/lib/publish', () => ({ ...jest.requireActual('../src/lib/publish'), fetchAccounts: async () => ({ accounts: [], plan: null, features: {}, plansEnabled: true, brandRole: 'owner', accountLimit: 1, planTier: 'free' }), fetchPosts: async () => [] }));
jest.mock('../src/lib/publishBrand', () => ({ ...jest.requireActual('../src/lib/publishBrand'), fetchBrands: async () => [] }));
jest.mock('../src/components/VeyCardPeek', () => ({ VeyCardPeek: () => null, peekRoom: () => 0 }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/components/cinema/creator/RulesLinks', () => ({ ...jest.requireActual('../src/components/cinema/creator/RulesLinks'), useCreatorScope: () => ({ live: () => true }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.FlatList, RN.Modal, RN.TextInput, RN.Image, RN.ActivityIndicator];
let root: Root;
const initialRtl = RN.I18nManager.isRTL;
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const calls = () => require('../src/lib/i18n').__calls as { key: string; locale: LocaleCode; plural: boolean }[];
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['de']); calls().length = 0; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); aiConsent.setUser(null); RN.I18nManager.isRTL = initialRtl; });
for (const screenLocale of Object.keys(APP_CATALOGS) as (keyof typeof APP_CATALOGS)[]) {
    const equal = require(`../src/lib/i18n/review/${screenLocale}-equal.json`);
    test.each([
        ['language choice', () => <LanguageChoice returnPath="/sign-in" />, 'vibe.language.title'],
        ['sign-in', () => <SignIn />, 'signIn.subtitle'],
        ['Home', () => <Home />, 'explore.start.title'],
        ['Create', () => <Create />, 'create.intro'],
        ['Credits', () => <Credits />, 'credits.title'],
    ] as const)(`${screenLocale} %s renders translated app copy with no missing key or English fallback`, async (_name, screen, headline) => {
        setLocaleFromDevice([screenLocale]);
        RN.I18nManager.isRTL = screenLocale === 'ar';
        await act(async () => root.render(screen()));
        expect(textOf(root.container)).toContain(t(headline));
        expect(calls().length).toBeGreaterThan(3);
        if (screenLocale === 'ar') {
            const headlineNodes = root.container.queryAll(n => n.type === 'Text' && textOf(n) === t(headline));
            expect(headlineNodes.length).toBeGreaterThan(0);
            for (const node of headlineNodes) expect(RN.StyleSheet.flatten(node.props.style).writingDirection).toBe('rtl');
        }
        for (const { key, locale, plural } of calls()) {
            expect(locale).toBe(screenLocale);
            const actualKey = plural ? `${key}.other` : key;
            const own = CATALOGS[screenLocale]!;
            expect({ actualKey, present: Object.hasOwn(own, actualKey) }).toEqual({ actualKey, present: true });
            if (!webKeys.includes(actualKey) && !BINDING_ENGLISH_KEYS.includes(actualKey as any) && !Object.hasOwn(equal, actualKey)) {
                expect({ actualKey, value: own[actualKey] }).not.toEqual({ actualKey, value: (en as Record<string, string>)[actualKey] });
            }
        }
    });
}
for (const locale of Object.keys(APP_CATALOGS) as (keyof typeof APP_CATALOGS)[]) {
    test(`${locale}: rendered sign-in and AI statements are entirely English with English accessibility`, async () => {
        setLocaleFromDevice([locale]);
        await act(async () => root.render(<><ConsentRow agreed={false} onChange={() => {}} /><AiConsentHost /></>));
        aiConsent.setUser('translations-' + locale);
        await act(async () => { void aiConsent.ensure('/api/v1/generations', 'POST').catch(() => {}); });
        const label = english('signIn.agree', { age: 18, terms: english('label.Terms'), privacy: english('chrome.privacyPolicy') });
        const checkbox = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
        expect(checkbox.props.accessibilityLabel).toBe(label);
        expect(checkbox.props.accessibilityLanguage).toBe('en');
        expect(textOf(root.container)).toContain(label);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'link' && n.props.accessibilityLabel === t('label.Terms')).length).toBeGreaterThan(0);
        expect(root.container.queryAll(n => n.props.accessibilityLanguage === 'en' && textOf(n) === english('aiConsent.body')).length).toBeGreaterThan(0);
    });
    test.each([
        ['Credits', () => <Credits />, 'month'],
        ['Publish', () => <Publish />, 'year'],
        ['Unlock', () => <UnlockCard feature="calendar" onUnlocked={() => {}} />, 'year'],
    ] as const)(`${locale}: %s renders English renewal terms on the accessible text`, async (_name, screen, interval) => {
        setLocaleFromDevice([locale]);
        await act(async () => root.render(screen()));
        const statement = renewalTerms(interval, '9,99 €', RN.Platform.OS === 'ios' ? 'ios' : 'android');
        expect(statement).toContain(`9,99 € per ${interval}. Renews automatically each ${interval}`);
        expect(root.container.queryAll(n => n.props.accessibilityLanguage === 'en' && textOf(n) === statement).length).toBeGreaterThan(0);
    });
    test(`${locale}: versioned Cinema declarations render English on the actual checkbox`, async () => {
        setLocaleFromDevice([locale]);
        await act(async () => root.render(<SubmitPanel title={{ id: 'test', title: 'Test' } as any} onDone={() => {}} />));
        for (const statement of [RIGHTS_TEXT, SAFETY_TEXT, MALWARE_TEXT]) {
            const nodes = root.container.queryAll(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === statement);
            expect(nodes.length).toBeGreaterThan(0);
            for (const node of nodes) expect(node.props.accessibilityLanguage).toBe('en');
        }
    });
}
