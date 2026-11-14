import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { SignupOffer } from '../src/components/SignupOffer';
import { HARD_PAYWALL_STARTER_CREDITS } from '../src/lib/hardPaywall';
import { creditsCardKeys } from '../src/lib/firstRun';
import { SIGNUP_FREE_CREDITS, signupOfferCopy } from '../src/lib/signupOffer';
import { plural, t } from '../src/lib/i18n';

const flag = process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED;
let root: Root;
const texts = () => root.container.queryAll((n) => n.type === 'Text' || n.type === 'RCTText').map((n) => n.props.children).flat(Infinity);

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => {
    await act(async () => root.unmount());
    if (flag === undefined) delete process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED; else process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED = flag;
});

test('without the hard paywall the offer is the confirm-email grant', () => {
    expect(signupOfferCopy(null)).toEqual({ title: 'signIn.offer.title', count: SIGNUP_FREE_CREDITS, body: 'signIn.offer.body' });
});

test('with the hard paywall the offer uses the welcome card\'s own words, never the 90-day confirm-email promise', () => {
    const copy = signupOfferCopy(HARD_PAYWALL_STARTER_CREDITS);
    const card = creditsCardKeys(25, HARD_PAYWALL_STARTER_CREDITS);
    expect(copy.body).toBe(card.body);
    expect(copy.params).toEqual(card.params);
    expect(copy.body).not.toBe('signIn.offer.body');
});

test('the rendered offer follows the hard paywall switch', async () => {
    process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED = 'true';
    await act(async () => root.render(<SignupOffer />));
    expect(texts()).toContain(t('credits.hardPaywall.bodyFree', { count: HARD_PAYWALL_STARTER_CREDITS }));
    expect(texts()).not.toContain(t('signIn.offer.body'));
    expect(texts()).toContain(plural('signIn.offer.title', HARD_PAYWALL_STARTER_CREDITS));
    await act(async () => root.unmount());
    root = createRoot();
    delete process.env.EXPO_PUBLIC_HARD_PAYWALL_ENABLED;
    await act(async () => root.render(<SignupOffer />));
    expect(texts()).toContain(t('signIn.offer.body'));
});
