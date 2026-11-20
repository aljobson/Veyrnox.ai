import { act } from 'react';
import { createRoot } from 'test-renderer';
import { SwapRow } from '../src/components/home/SwapRow';
import { swapRowPoster } from '../src/lib/templateSwap/row';
let mockCards: any[] = [];
const mockPush = jest.fn();
jest.mock('../src/lib/templateSwap/row', () => ({ ...jest.requireActual('../src/lib/templateSwap/row'), useSwapRow: () => mockCards }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-native', () => ({ Pressable: 'Pressable', ScrollView: 'ScrollView', View: 'View' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/lib/i18n', () => ({ t: (key: string, v?: any) => `${key}${v?.credits ? ':' + v.credits : ''}` }));
jest.mock('../src/components/ui', () => ({ Text: 'Text' }));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockPush.mockClear(); });
const card = { id: 'basketball-3', name: 'BASKETBALL 3', poster: '/showcase/viral-basketball-3.jpg', aspectRatio: '406 / 720', credits: 47 };
test('nothing renders while the row is empty (switch off or phone build without swap)', async () => {
    mockCards = []; const root = createRoot();
    try { await act(async () => root.render(<SwapRow />)); expect(root.container.queryAll(n => n.props.source)).toHaveLength(0); expect(root.container.queryAll(n => typeof n.props.children === 'string')).toHaveLength(0); }
    finally { await act(async () => root.unmount()); }
});
test('cards show the poster from the API origin, a title-cased name and the price, and open templates/[id]', async () => {
    mockCards = [card]; const root = createRoot();
    try {
        await act(async () => root.render(<SwapRow />));
        const image = root.container.queryAll(n => n.props.source?.uri?.endsWith('/showcase/viral-basketball-3.jpg'))[0];
        expect(image.props.source.uri).toBe(swapRowPoster(card.poster));
        const strings = root.container.queryAll(n => typeof n.props.children === 'string').map(n => n.props.children);
        expect(strings).toEqual(expect.arrayContaining(['presets.swap.title', 'Basketball 3', 'presets.swap.price:47']));
        const button = root.container.queryAll(n => typeof n.props.onPress === 'function')[0];
        await act(async () => button.props.onPress());
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: 'basketball-3' } });
    } finally { await act(async () => root.unmount()); }
});
