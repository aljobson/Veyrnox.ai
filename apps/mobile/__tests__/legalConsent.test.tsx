import { act, useState } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { AiConsentHost } from '../src/components/AiConsentHost';
import { ConsentRow } from '../src/components/ui/ConsentRow';
import { LegalDocumentView } from '../src/components/legal/LegalDocumentView';
import { aiConsent } from '../src/lib/aiConsentStore';
import { AI_CONSENT_TEXT } from '../src/lib/aiConsent';
import { legalData } from '../src/lib/legal';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
void [RN.View, RN.Text, RN.Pressable, RN.Modal, RN.ScrollView];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1, stopPropagation: jest.fn() };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const textOf = (n: TestInstance): string => n.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
const text = () => textOf(root.container);
async function press(label: string) { await act(async () => control(label).props.onClick(event)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    aiConsent.setUser('legal-test');
});
afterEach(async () => { await act(async () => root.unmount()); aiConsent.setUser(null); });

test.each([true, false])('read Privacy during pending consent, return, answer %s', async accepted => {
    await act(async () => root.render(<AiConsentHost />));
    const proceed = jest.fn(), decline = jest.fn();
    let request!: Promise<void>;
    await act(async () => {
        request = aiConsent.ensure('/api/v1/generations', 'POST').then(proceed, decline);
    });
    await press(AI_CONSENT_TEXT.privacyLabel);
    expect(text()).toContain(legalData('privacy', 'en').messages.title);
    expect(proceed).not.toHaveBeenCalled(); expect(decline).not.toHaveBeenCalled();
    // There is one native modal throughout, and the legal content has no acceptance action.
    expect(root.container.queryAll(n => n.props.onRequestClose !== undefined)).toHaveLength(1);
    expect(control(AI_CONSENT_TEXT.agree)).toBeUndefined();
    await press('Close');
    expect(proceed).not.toHaveBeenCalled(); expect(decline).not.toHaveBeenCalled();
    await press(accepted ? AI_CONSENT_TEXT.agree : AI_CONSENT_TEXT.decline);
    await request;
    expect(proceed).toHaveBeenCalledTimes(accepted ? 1 : 0);
    expect(decline).toHaveBeenCalledTimes(accepted ? 0 : 1);
    if (!accepted) expect(decline.mock.calls[0][0].code).toBe('consent_declined');
});

test('sign-in consent survives touch and accessibility legal reading, including cross-document Back', async () => {
    function SignIn() {
        const [agreed, setAgreed] = useState(false);
        return <ConsentRow agreed={agreed} onChange={setAgreed} />;
    }
    await act(async () => root.render(<SignIn />));
    const checkbox = () => root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[0];
    await act(async () => checkbox().props.onClick(event));
    expect(checkbox().props.accessibilityState.checked).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'link' && n.props.accessibilityLabel === 'Terms').length).toBeGreaterThan(0);
    await press('Terms');
    expect(text()).toContain(legalData('terms', 'en').messages.title);
    await press('Privacy');
    expect(text()).toContain(legalData('privacy', 'en').messages.title);
    await press('Back');
    expect(text()).toContain(legalData('terms', 'en').messages.title);
    await press('Close');
    expect(checkbox().props.accessibilityState.checked).toBe(true);
    await press('Privacy Policy');
    await press('Close');
    expect(checkbox().props.accessibilityState.checked).toBe(true);
    const sentence = () => root.container.queryAll(n => n.props.importantForAccessibility === 'no-hide-descendants' && n.props.onClick)[0];
    expect(sentence().props.accessible).toBe(false);
    expect(sentence().props.accessibilityElementsHidden).toBe(true);
    expect(sentence().queryAll(n => n.props.accessibilityRole === 'link')).toHaveLength(0);
    await act(async () => sentence().props.onClick(event));
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    await press('Terms');
    await press('Close');
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    await act(async () => sentence().props.onClick(event));
    expect(checkbox().props.accessibilityState.checked).toBe(true);
});

test('legal documents render entity slots, strong text, native links and inert external addresses', async () => {
    const navigate = jest.fn();
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue(undefined);
    await act(async () => root.render(<LegalDocumentView doc="privacy" onNavigate={navigate} />));
    expect(text()).toContain('Veyrnox Ltd');
    expect(text()).toContain('17299951');
    expect(text()).not.toMatch(/\{(?:inline\d+|companyNo|name|email|jurisdiction)\}/);
    const links = root.container.queryAll(n => n.props.accessibilityRole === 'link');
    expect(links.filter(n => textOf(n)?.includes('policies.google.com/privacy'))).toHaveLength(0);
    expect(text()).toContain('https://policies.google.com/privacy');
    const mail = links.find(n => n.props.onPress && textOf(n)?.includes('privacy@'))!;
    await act(async () => mail.props.onPress(event));
    expect(open).toHaveBeenCalledWith('mailto:privacy@veyrnox.com');
    open.mockRestore();
});
test('non-English supply statement is explicitly English and isolated left-to-right', async () => {
    await act(async () => root.render(<LegalDocumentView doc="terms" locale="ar" onNavigate={jest.fn()} />));
    expect(text()).toContain(legalData('terms', 'ar').entity.jurisdiction);
    expect(text()).toContain('\u2066');
    expect(root.container.queryAll(n => n.props.accessibilityLanguage === 'en').length).toBeGreaterThan(0);
});
