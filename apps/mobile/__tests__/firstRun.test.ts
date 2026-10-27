import en from '../src/lib/i18n/messages/en';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

import { FIRST_RUN_SLOT, FIRST_RUN_VERSION, WELCOME_CARDS, creditsCardKeys, hasSeenWelcome, serializeSeen } from '../src/lib/firstRun';

describe('the first-run record (N3)', () => {
    test('nothing stored means the welcome has not been seen', () => {
        expect(hasSeenWelcome(null)).toBe(false);
        expect(hasSeenWelcome(undefined)).toBe(false);
        expect(hasSeenWelcome('')).toBe(false);
    });

    test('only our own versioned record counts as seen', () => {
        expect(hasSeenWelcome(serializeSeen())).toBe(true);
        expect(FIRST_RUN_VERSION).toBe(2);
        expect(FIRST_RUN_SLOT).toBe('veyrnox.welcome.seen.v2');
        expect(hasSeenWelcome('{"version":1,"seen":true}')).toBe(false);
        expect(hasSeenWelcome('{"version":3,"seen":true}')).toBe(false);
        expect(hasSeenWelcome('{"version":1,"seen":false}')).toBe(false);
        expect(hasSeenWelcome('true')).toBe(false);
        expect(hasSeenWelcome('not json')).toBe(false);
        expect(hasSeenWelcome('[]')).toBe(false);
    });

    test('the storage name uses only the characters SecureStore allows', () => {
        expect(FIRST_RUN_SLOT).toMatch(/^[A-Za-z0-9._-]+$/);
    });
});

describe('the cards', () => {
    test('there are three, in order: hello, credits, start', () => {
        expect(WELCOME_CARDS).toEqual(['hello', 'credits', 'start']);
    });

    test('the credits card names the real free amount when the server gave one', () => {
        expect(creditsCardKeys(10)).toEqual({ title: 'welcome.credits.title', body: 'welcome.credits.free', count: 10 });
        expect(creditsCardKeys(1).count).toBe(1);
    });

    test('with no free credits, or an unreadable amount, it explains credits without a number', () => {
        for (const n of [0, -3, Number.NaN, null, undefined]) {
            expect(creditsCardKeys(n as number | null | undefined)).toEqual({ title: 'welcome.credits.title', body: 'welcome.credits.generic', count: null });
        }
    });
});

describe('where the welcome shows', () => {
    test('the shared consent and provider controls introduce creation on sign-in', () => {
        const signIn = read('app', 'sign-in.tsx');
        const copy = read('lib', 'i18n', 'messages', 'en', 'signIn.ts');
        expect(signIn).toContain('<ConsentRow agreed={agreed}');
        expect(signIn).toMatch(/<AuthProviderButton\s+provider="apple"/);
        expect(signIn).toMatch(/<AuthProviderButton\s+provider="google"/);
        expect(signIn).toContain('if (!agreed || busy || running.current) return');
        expect(copy).toContain("'signIn.title': 'Start with something real.'");
        expect(copy).toContain('photo, video, reference or idea');
    });

    test('email authentication keeps the same visual momentum', () => {
        const email = read('app', 'email.tsx');
        const copy = read('lib', 'i18n', 'messages', 'en', 'email.ts');
        expect(email).toMatch(/<SegmentedControl\s+value=\{mode\}/);
        expect(email).toContain("value: 'signUp'");
        expect(email).toMatch(/<TextField\s+label=\{t\('authGate.email'\)\}/);
        expect(email).toMatch(/<TextField\s+ref=\{passwordRef\}/);
        expect(email).toContain("t('email.securityReady')");
        expect(email).toContain('retrySecurityCheck');
        expect(email).toContain('passwordVisible');
        expect(email).toContain('keyboardDismissMode="interactive"');
        expect(email).toContain("signInWithOAuth('google')");
        expect(email).toContain('signInWithApple()');
        expect(email).toContain('nativeAvailable={appleNativeAvailable}');
        expect(copy).toContain("'email.orUseEmail': 'Or continue with email'");
        expect(copy).toContain("'email.signInCta': 'Sign in and start creating'");
        expect(copy).toContain("'email.signUpCta': 'Create account and continue'");
    });

    test('the signed-in layout sends a first-time person to it, and the screen records it was seen', () => {
        expect(read('app', '(app)', '_layout.tsx')).toContain('FirstRunGate');
        const gate = read('components', 'FirstRunGate.tsx');
        expect(gate).toContain('firstRunDestination');
        const decision = read('lib', 'firstRunPending.ts');
        expect(decision).toContain("return '/welcome'");
        expect(decision).toContain('appStorage.get(FIRST_RUN_SLOT)');
        const screen = read('app', '(app)', 'welcome.tsx');
        expect(screen).toContain('markWelcomeSeen');
        expect(read('lib', 'markWelcomeSeen.ts')).toContain('appStorage.set(FIRST_RUN_SLOT, seen)');
        expect(screen).toContain("t('welcome.skip')");
    });

    test('welcome opens the Mobbin-inspired, input-first creation screen instead of the preference quiz', () => {
        const welcome = read('app', '(app)', 'welcome.tsx');
        const start = read('app', '(app)', 'start.tsx');
        expect(welcome).toContain("router.replace('/start')");
        for (const [key, label] of [['start.myphoto', 'My photo'], ['start.myvideo', 'My video'], ['start.areference', 'A reference'], ['start.justanidea', 'Just an idea']]) {
            expect(start).toContain(`label: t('${key}')`);
            expect((en as Record<string, string>)[key]).toBe(label);
        }
        expect(start).toContain('selected={source === item.key}');
        expect(start).toContain("t('start.ortryatemplate')");
        expect(en['start.ortryatemplate']).toBe('Or try a template');
        expect(start).toContain('presetHref(template)');
    });

    test('the Mobbin-inspired creation goal is the first personalization choice', () => {
        const screen = read('app', '(app)', 'vibe.tsx');
        const copy = read('lib', 'i18n', 'messages', 'en', 'vibe.ts');
        expect(screen).toContain("const STEPS = ['goal', 'look', 'pace', 'chaos', 'destination', 'audience', 'voice']");
        expect(copy).toContain("'vibe.goal.title': 'What do you want to make first?'");
        expect(copy).toContain("'vibe.goal.sell': 'Promote a product'");
        expect(copy).toContain("'vibe.goal.meme': 'Make a social ad'");
        expect(copy).toContain("'vibe.goal.character': 'Animate my photo'");
        expect(copy).toContain("'vibe.goal.story': 'Tell a story'");
    });

    test('single-choice goals advance on one tap', () => {
        const screen = read('app', '(app)', 'vibe.tsx');
        expect(screen).toContain('const GOAL_PRESENTATION');
        expect(screen).toContain('selected={draft.goal === goal}');
        expect(screen).toContain("onPress={() => choose('goal', goal)}");
        expect(screen).not.toContain('disabled={!draft.goal}');
    });
});
