import { screenSafePadding } from '../src/components/SafeContentScrollView';

describe('safe content layout', () => {
    const landscape = { top: 0, right: 59, bottom: 21, left: 59 };

    test('stack content protects landscape sides and the home indicator without double-insetting the header', () => {
        expect(screenSafePadding(landscape, 16)).toEqual({
            paddingTop: 16,
            paddingRight: 75,
            paddingBottom: 37,
            paddingLeft: 75,
        });
    });

    test('standalone public content also protects the physical top edge', () => {
        expect(screenSafePadding({ top: 47, right: 0, bottom: 34, left: 0 }, 16, true)).toEqual({
            paddingTop: 63,
            paddingRight: 16,
            paddingBottom: 50,
            paddingLeft: 16,
        });
    });
});
