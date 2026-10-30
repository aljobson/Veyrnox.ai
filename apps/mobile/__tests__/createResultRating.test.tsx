import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CreateResult } from '../src/components/create/CreateResult';

const mockRouter = { push: jest.fn() };
let mockAsked: { asked: true; at: string } | null = null;
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/components/library/GeneratedChip', () => ({ GeneratedChip: () => null }));
jest.mock('../src/lib/createResult', () => ({
    useJobResult: () => ({ state: 'succeeded', job: { refunded: false }, asset: { url: 'https://x/a.png', mime_type: 'image/png' } }),
    soundPassFor: () => null,
}));
jest.mock('../src/lib/celebrate', () => ({
    celebrateOutput: jest.fn(() => ({ big: true, done: Promise.resolve() })),
    afterCelebration: jest.fn((_r: unknown, _d: number, _s: AbortSignal, cb: () => void) => { cb(); return () => {}; }),
}));
jest.mock('../src/lib/storeReview', () => ({ loadReviewAsk: async () => mockAsked }));

const batch = { ids: ['11111111-1111-4111-8111-111111111111'], modelId: 'nano-banana', kind: 'image' as const, aspect: '1:1', duration: null, count: 1 };

beforeEach(() => {
    mockRouter.push.mockClear();
    require('../src/lib/reviewAsk').resetReviewAskClaim();
});

test('the first finished result on Create asks for a rating after the celebration', async () => {
    mockAsked = null;
    await act(async () => { createRoot().render(<CreateResult api={{} as never} batch={batch} catalog={[]} onTerminal={() => {}} />); });
    expect(mockRouter.push).toHaveBeenCalledWith('/rate');
});

test('a phone that was already asked is not asked again', async () => {
    mockAsked = { asked: true, at: '2026-10-30T00:00:00Z' };
    await act(async () => { createRoot().render(<CreateResult api={{} as never} batch={batch} catalog={[]} onTerminal={() => {}} />); });
    expect(mockRouter.push).not.toHaveBeenCalled();
});
