import { act, createElement } from 'react';
import { createRoot } from 'test-renderer';
import { AccessibilityInfo, Animated } from 'react-native';
import { LowBalanceNote } from '../src/components/LowBalanceNote';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const path = require('path') as { join: (...p: string[]) => string };

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');

describe('the companion on a paywall', () => {
    test('peeks over the chosen card only, as decoration', () => {
        expect(read('app', '(app)', 'credits.tsx')).toContain('{chosenId === item.id ? <VeyCardPeek /> : null}');
        expect(read('components', 'UnlockCard.tsx')).toContain('{selected === p.id ? <VeyCardPeek');
        expect(read('app', '(app)', '(tabs)', 'publish.tsx')).toContain('{selectedPlan === plan.id ? <VeyCardPeek width={72} /> : null}');
        for (const file of [['app', '(app)', 'credits.tsx'], ['components', 'UnlockCard.tsx'], ['app', '(app)', '(tabs)', 'publish.tsx']]) {
            const source = read(...file);
            expect((source.match(/<VeyCardPeek/g) ?? []).length).toBe(1);
            expect(source).not.toMatch(/notify\(|useVeyPaywallMood|VeyPaywallBuddy/);
        }
        const peek = read('components', 'VeyCardPeek.tsx');
        expect(peek).toContain('pointerEvents="none"');
        expect(peek).toContain('overflow: \'hidden\'');
        // No words of its own: nothing to translate, and nothing a screen reader reads twice.
        expect(peek).not.toMatch(/\bt\('/);
        expect(peek).not.toContain('<Text');
    });
});

describe('the Vey character', () => {
    test('stands still under Reduce Motion whatever the mood', () => {
        const character = read('components', 'VeyCharacter.tsx');
        expect(character).toContain('isReduceMotionEnabled');
        expect(character).toMatch(/if \(still\) \{[\s\S]*?droop\.setValue\(0\);[\s\S]*?return;/);
    });
});

test('low balance renders worried decorative Vey after text and a working Buy credits button', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
    const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
    const root = createRoot();
    try {
        await act(async () => root.render(createElement(LowBalanceNote, { balance: 0 })));
        const buttons = root.container.queryAll(n => n.props.accessibilityRole === 'button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].queryAll(n => n.children.includes(t('lowBalance.buy')))).toHaveLength(1);
        const art = root.container.queryAll(n => n.props.pointerEvents === 'none')[0];
        expect(art.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
        expect(art.props.style.width).toBe(40);
        expect(art.parent!.children.indexOf(buttons[0].parent!)).toBeLessThan(art.parent!.children.indexOf(art));
        expect(timing.mock.calls.some(([, config]) => config.duration === 320 && config.toValue === 1)).toBe(true);
        await act(async () => buttons[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(mockPush).toHaveBeenCalledWith('/credits');
    } finally {
        await act(async () => root.unmount()); timing.mockRestore(); loop.mockRestore(); jest.restoreAllMocks();
    }
});
