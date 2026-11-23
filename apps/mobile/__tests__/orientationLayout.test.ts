import { modalSafePadding, readableWidth } from '../src/lib/modalLayout';
import { onboardingChoiceLayout } from '../src/lib/onboardingLayout';

declare const require: (id: string) => { expo: { orientation?: string } };
const appConfig = require('../app.json');

describe('orientation-safe layout contracts', () => {
    test('app-wide landscape stays deferred until the isolated integration audit', () => {
        expect(appConfig.expo.orientation).toBe('portrait');
    });
    test('full-screen modal padding protects every physical safe-area edge', () => {
        expect(modalSafePadding({ top: 0, right: 59, bottom: 21, left: 59 }, 16)).toEqual({
            paddingTop: 16,
            paddingRight: 75,
            paddingBottom: 37,
            paddingLeft: 75,
        });
    });

    test('readable content width subtracts landscape side insets before applying its cap', () => {
        const insets = { top: 0, right: 59, bottom: 21, left: 59 };
        expect(readableWidth(844, insets, 960)).toBe(726);
        expect(readableWidth(1194, insets, 720)).toBe(720);
    });

    test.each([
        [390, 1, 1, 'tile'],
        [844, 1, 1, 'tile'],
        [390, 1.3, 1, 'row'],
        [390, 1.1, 1.25, 'row'],
        [320, 1, 1, 'row'],
    ] as const)('onboarding choices at %ipx, %ix system and %ix app text use %s layout', (width, fontScale, appScale, expected) => {
        expect(onboardingChoiceLayout(width, fontScale, appScale)).toBe(expected);
    });
});
