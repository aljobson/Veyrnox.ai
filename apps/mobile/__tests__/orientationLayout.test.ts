import { bottomSheetSafePadding, modalSafePadding, readableWidth } from '../src/lib/modalLayout';
import { onboardingChoiceLayout } from '../src/lib/onboardingLayout';
import { tabHeaderShowsWordmark } from '../src/lib/headerLayout';

declare const require: (id: string) => { expo: { orientation?: string } };
const appConfig = require('../app.json');

describe('orientation-safe layout contracts', () => {
    test('the isolated integration audit unlocks portrait and landscape', () => {
        expect(appConfig.expo.orientation).toBe('default');
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

    test('bottom sheets protect landscape sides and bottom without adding the portrait status-bar inset', () => {
        expect(bottomSheetSafePadding({ top: 62, right: 59, bottom: 34, left: 59 }, 16, 24, 48)).toEqual({
            paddingTop: 24,
            paddingRight: 75,
            paddingBottom: 50,
            paddingLeft: 75,
        });
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

    test.each([[320, 1, false], [360, 1, false], [389, 1, false], [390, 1, true], [430, 1, true], [390, 1.6, false], [430, 1.6, false]] as const)(
        'the %ipx tab header at %ix text scale wordmark visibility is %s', (width, fontScale, expected) => {
            expect(tabHeaderShowsWordmark(width, fontScale)).toBe(expected);
        },
    );
});
