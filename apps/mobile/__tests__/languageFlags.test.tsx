import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { LanguageChoice } from '../src/components/LanguageChoice';
import { LANGUAGES } from '../src/lib/language';
import { ACTIVE_LOCALES, setLocaleFromDevice } from '../src/lib/i18n';
jest.mock('../src/lib/languageStore', () => ({ readLanguage: () => null, loadLanguage: async () => null, saveLanguage: jest.fn(async () => true), saveAccountLanguage: jest.fn() }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'signedOut', api: {}, canReloadSession: () => false }) }));
jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../src/components/BrandHeader', () => ({ BrandHeader: () => null }));
jest.mock('../src/components/ui', () => {
    const React = require('react');
    const component = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
    return { Text: component('text'), Button: component('button'), Chip: component('chip'),
        themedStyles: (fn: any) => fn(require('../src/theme').tokensForScheme('dark')), useThemedStyles: (s: any) => s };
});
void [RN.View, RN.ScrollView];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test('every language row shows its flag before its name, while the row is still labelled with the plain name', async () => {
    await act(async () => root.render(<LanguageChoice returnPath="/vibe" active={ACTIVE_LOCALES} />));
    const rows = root.container.queryAll(n => n.type === 'chip');
    expect(rows).toHaveLength(ACTIVE_LOCALES.length);
    for (const l of LANGUAGES.filter(x => (ACTIVE_LOCALES as readonly string[]).includes(x.code))) {
        const row = rows.find(r => r.props.label === l.name)!;
        expect(row.props.accessibilityRole).toBe('radio');
        expect(row.props.accessibilityLanguage).toBe(l.tag);
        expect(row.props.accessibilityLabel).toBeUndefined(); // Chip labels the row from `label`: the name alone
        const [flag, name] = row.queryAll(n => n.type === 'text');
        expect(flag.props.children).toBe(l.flag);
        expect(flag.props.accessibilityElementsHidden).toBe(true);
        expect(flag.props.importantForAccessibility).toBe('no');
        expect(name.props.children).toBe(l.name);
    }
});
