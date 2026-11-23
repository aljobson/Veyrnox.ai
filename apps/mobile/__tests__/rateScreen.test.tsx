import { act } from 'react';
import { createRoot } from 'test-renderer';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Rate from '../src/app/(app)/rate';
import { markReviewAsked, openRatingSheet } from '../src/lib/storeReview';
import { t } from '../src/lib/i18n';

const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/lib/storeReview', () => ({ markReviewAsked: jest.fn(async () => {}), openRatingSheet: jest.fn(async () => {}) }));

async function press(label: string) {
    const root = createRoot();
    await act(async () => root.render(<Rate />));
    const button = root.container.queryAll((n) => n.props.accessibilityRole === 'button' && n.queryAll((c) => c.props.children === label).length > 0)[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}

beforeEach(() => { jest.clearAllMocks(); mockRouter.canGoBack.mockReturnValue(true); });

test('showing the ask records it, and Not now closes the screen without opening the store sheet', async () => {
    await press(t('rate.later'));
    expect(markReviewAsked).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(openRatingSheet).not.toHaveBeenCalled();
});

test('Rate closes the screen and opens the store rating sheet', async () => {
    await press(t('rate.cta'));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(openRatingSheet).toHaveBeenCalledTimes(1);
});

test('opened with nothing behind it, Not now goes home instead of doing nothing', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await press(t('rate.later'));
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

test('Rate remains scrollable inside landscape physical edges', async () => {
    const root = createRoot();
    await act(async () => root.render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 59, bottom: 21, left: 59 }}><Rate /></SafeAreaInsetsContext.Provider>,
    ));
    const page = root.container.queryAll(node => node.props.keyboardShouldPersistTaps === 'handled')[0];
    expect(StyleSheet.flatten(page.props.contentContainerStyle)).toMatchObject({ paddingLeft: 83, paddingRight: 83, paddingBottom: 45 });
    await act(async () => root.unmount());
});
