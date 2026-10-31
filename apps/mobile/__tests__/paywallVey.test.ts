import { isPlanPick, paywallVey, type PaywallVeyState } from '../src/billing/paywallVey';
import en from '../src/lib/i18n/messages/en/billing';

const open = paywallVey(null, { type: 'open', offering: 'credits' });

test('Vey waves hello with a line for the offering that opened', () => {
    expect(open).toEqual({ mood: 'wave', line: 'billing.paywall.vey.hello.credits' });
});

test('Vey follows the purchase: pick, check, store, then a calm cancel', () => {
    let s: PaywallVeyState = paywallVey(open, { type: 'pick' });
    expect(s.mood).toBe('hop');
    s = paywallVey(s, { type: 'checking' });
    expect(s.mood).toBe('working');
    s = paywallVey(s, { type: 'store' });
    expect(s.line).toBe('billing.paywall.vey.store');
    s = paywallVey(s, { type: 'cancelled' });
    expect(s).toEqual({ mood: 'idle', line: 'billing.paywall.vey.cancelled' });
});

test('a refused purchase makes Vey worried and says why', () => {
    expect(paywallVey(open, { type: 'refused', result: 'generation_already_active' }))
        .toEqual({ mood: 'worried', line: 'billing.paywall.alreadyActive' });
});

test('Vey claps after a purchase and nothing but a new paywall interrupts it', () => {
    const done = paywallVey(open, { type: 'purchased', offering: 'generation' });
    expect(done).toEqual({ mood: 'clap', line: 'billing.paywall.vey.done.generation' });
    expect(paywallVey(done, { type: 'failed' })).toBe(done);
    expect(paywallVey(done, { type: 'poke' })).toBe(done);
    expect(paywallVey(done, { type: 'open', offering: 'publish' }).mood).toBe('wave');
});

test('a tap on Vey hops without changing what Vey is saying', () => {
    const s = paywallVey(paywallVey(open, { type: 'failed' }), { type: 'poke' });
    expect(s).toEqual({ mood: 'hop', line: 'billing.paywall.vey.failed' });
});

test('plan taps and monthly/yearly switches count as picks; buttons do not', () => {
    expect(isPlanPick('package')).toBe(true);
    expect(isPlanPick('tab')).toBe(true);
    expect(isPlanPick('purchase_button')).toBe(false);
});

test('every line Vey can say has English copy', () => {
    const keys = ['generation', 'credits', 'publish'].flatMap(o => [`billing.paywall.vey.hello.${o}`, `billing.paywall.vey.done.${o}`])
        .concat(['pick', 'checking', 'store', 'cancelled', 'failed'].map(k => `billing.paywall.vey.${k}`));
    for (const key of keys) expect(en).toHaveProperty([key]);
});
