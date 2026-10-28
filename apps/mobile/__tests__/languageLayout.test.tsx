import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import TabsLayout from '../src/app/(app)/(tabs)/_layout';
import { LanguageChoice } from '../src/components/LanguageChoice';
import { saveLanguage, syncPendingAccountLanguage } from '../src/lib/languageStore';
import { reloadAppAsync } from 'expo';
import { LanguageGate } from '../src/components/LanguageGate';
import * as direction from '../src/lib/languageDirection';
import { changeLanguage } from '../src/lib/languageTransition';
import { CATALOGS, getLocale, setLocaleFromDevice, startupLocale, t } from '../src/lib/i18n';
import { DEFAULT_APPEARANCE } from '../src/theme';
let mockStored: string | null = null;
let mockStatus = 'signedOut';
const mockBack = jest.fn();
const mockScreens: any[] = [];
const spanish = CATALOGS.es as Record<string, string>;
const originalTab = spanish['tabs.library'];
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => mockStored, loadLanguage: async () => mockStored, saveLanguage: jest.fn(async (code: string) => { mockStored = code; return true; }), saveAccountLanguage: jest.fn(), syncPendingAccountLanguage: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ generation: 0, sessionGeneration: () => 0, beginSessionTask: () => ({ gen: 0, user: 'u', current: () => true, tokens: async () => null }), status: mockStatus, canReloadSession: () => false, api: {} }) }));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
jest.mock('expo-router', () => {
    const React = require('react');
    const Tabs = ({ children }: any) => React.createElement('tabs', null, children);
    Tabs.Screen = (props: any) => { mockScreens.push(props); return null; };
    return { Tabs, useGlobalSearchParams: () => ({}), useSegments: () => [], usePathname: () => '/sign-in', useRouter: () => ({ back: mockBack }) };
});
jest.mock('../src/components/HeaderChips', () => ({ HeaderRight: () => null }));
jest.mock('../src/components/Logo', () => ({ Logo: () => null }));
jest.mock('../src/components/MenuDrawer', () => ({ MenuButton: () => null }));
jest.mock('../src/components/ui', () => {
    const React = require('react');
    return {
        useAppearance: () => ({ settings: require('../src/theme').DEFAULT_APPEARANCE, scheme: 'dark' }),
        Text: ({ children, ...props }: any) => React.createElement('text', props, children),
        Icon: () => null,
        Chip: (props: any) => React.createElement('chip', props),
        Button: (props: any) => React.createElement('button', props),
        themedStyles: (fn: any) => fn(require('../src/theme').tokensForScheme('dark')),
        useThemedStyles: (s: any) => s,
    };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
void [RN.View, RN.ScrollView, DEFAULT_APPEARANCE];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockStored = null; mockStatus = 'signedOut'; jest.clearAllMocks(); mockScreens.length = 0; spanish['tabs.library'] = 'Biblioteca'; setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); if (originalTab === undefined) delete spanish['tabs.library']; else spanish['tabs.library'] = originalTab; });
test('reloading an already mounted LTR layout remounts its titles and accessibility labels in Spanish', async () => {
    await act(async () => root.render(<TabsLayout />));
    const before = mockScreens.find(s => s.name === 'library').options;
    expect(before.title).toBe(t('tabs.library'));
    await act(async () => {
        expect(await changeLanguage('es', '/language', { signedIn: true, canReloadSession: () => true }, {
            active: ['en', 'es'], saveReturn: async () => true, load: async () => 'en',
            save: async code => { mockStored = code; return true; }, direction: jest.fn(),
            reload: async () => { root.unmount(); setLocaleFromDevice([startupLocale(mockStored, ['de-DE'], ['en', 'es'])]); root = createRoot(); root.render(<TabsLayout />); },
        })).toBe(true);
    });
    const after = mockScreens.filter(s => s.name === 'library').at(-1).options;
    expect(getLocale()).toBe('es');
    expect(after.title).toBe('Biblioteca');
    expect(after.title).not.toBe(before.title);
    expect(after.tabBarAccessibilityLabel).toBe(t('tabs.library'));
    // The mounted layout must use the newly selected app catalog.
    expect(t('label.Library')).toBe('Biblioteca');
});
test('first screen bypasses English-only and offers exactly the injected active choices otherwise', async () => {
    await act(async () => root.render(<LanguageGate active={['en']}><RN.Text>Sign-in fixture</RN.Text></LanguageGate>));
    expect(root.container.queryAll(n => n.props.label === 'English')).toHaveLength(0);
    await act(async () => root.render(<LanguageGate active={['en', 'es']}><RN.Text>Sign-in fixture</RN.Text></LanguageGate>));
    const labels = root.container.queryAll(n => n.props.label === 'English' || n.props.label === 'Español').map(n => n.props.label);
    expect(labels).toEqual(['English', 'Español']);
    expect(root.container.queryAll(n => n.props.children === 'Sign-in fixture')).toHaveLength(0);
});

test.each(['loading', 'signedIn'])('the first-launch gate never flashes while %s', async status => {
    mockStatus = status;
    await act(async () => root.render(<LanguageGate active={['en', 'es']}><RN.Text>Restoring</RN.Text></LanguageGate>));
    expect(root.container.queryAll(n => n.props.label === 'English')).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.children === 'Restoring')).toHaveLength(1);
});
test('the gate only attempts a pending-choice sync after restoration completes', async () => {
    mockStatus = 'loading';
    await act(async () => root.render(<LanguageGate><RN.Text>App</RN.Text></LanguageGate>));
    expect(syncPendingAccountLanguage).not.toHaveBeenCalled();
    mockStatus = 'signedIn';
    await act(async () => root.render(<LanguageGate><RN.Text>App</RN.Text></LanguageGate>));
    expect(syncPendingAccountLanguage).toHaveBeenCalledTimes(1);
});
test('Account chooser returns on reselecting the current language without storage or reload', async () => {
    mockStatus = 'signedIn';
    await act(async () => root.render(<LanguageChoice active={['en', 'es']} returnPath="/language" />));
    await act(async () => root.container.queryAll(n => n.type === 'button')[0].props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(saveLanguage).not.toHaveBeenCalled();
    expect(reloadAppAsync).not.toHaveBeenCalled();
});
test('first launch remembers an unchanged device language and advances to sign-in without reload', async () => {
    await act(async () => root.render(<LanguageGate active={['en', 'es']}><RN.Text>Sign-in fixture</RN.Text></LanguageGate>));
    await act(async () => root.container.queryAll(n => n.type === 'button')[0].props.onPress());
    expect(saveLanguage).toHaveBeenCalledWith('en', true);
    expect(root.container.queryAll(n => n.props.children === 'Sign-in fixture')).toHaveLength(1);
    expect(reloadAppAsync).not.toHaveBeenCalled();
});


test.each([true, false])('confirming the current locale reconciles native direction, firstLaunch=%s', async firstLaunch => {
    const repair = jest.spyOn(direction, 'reconcileLanguageDirection').mockResolvedValue(true);
    const complete = jest.fn();
    mockStatus = firstLaunch ? 'signedOut' : 'signedIn';
    try {
        await act(async () => root.render(<LanguageChoice active={['en', 'de']} returnPath={firstLaunch ? '/sign-in' : '/language'} onComplete={firstLaunch ? complete : undefined} />));
        await act(async () => root.container.queryAll(n => n.type === 'button')[0].props.onPress());
        expect(repair).toHaveBeenCalledWith(firstLaunch ? '/sign-in' : '/language', expect.objectContaining({ signedIn: !firstLaunch }));
        if (firstLaunch) expect(complete).toHaveBeenCalledTimes(1);
        else expect(mockBack).toHaveBeenCalledTimes(1);
    } finally { repair.mockRestore(); }
});


test('the recovery startup does not consume or send a pending account-language choice', async () => {
    mockStatus = 'signedIn';
    mockStored = 'de';
    const repaired = jest.spyOn(direction.directionReconciler, 'handledRepair').mockReturnValue(true);
    try {
        await act(async () => root.render(<LanguageGate><RN.Text>App</RN.Text></LanguageGate>));
        expect(syncPendingAccountLanguage).not.toHaveBeenCalled();
    } finally { repaired.mockRestore(); }
});
