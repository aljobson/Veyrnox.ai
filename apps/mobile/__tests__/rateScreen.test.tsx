import { act } from 'react';
import { createRoot } from 'test-renderer';
import Rate from '../src/app/(app)/rate';
import { markReviewAsked, openRatingSheet } from '../src/lib/storeReview';
import { t } from '../src/lib/i18n';

const mockRouter = { back: jest.fn() };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/lib/storeReview', () => ({ markReviewAsked: jest.fn(async () => {}), openRatingSheet: jest.fn(async () => {}) }));

async function press(label: string) {
    const root = createRoot();
    await act(async () => root.render(<Rate />));
    const button = root.container.queryAll((n) => n.props.accessibilityRole === 'button' && n.queryAll((c) => c.props.children === label).length > 0)[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}

beforeEach(() => jest.clearAllMocks());

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
