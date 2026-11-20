import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import History from '../src/app/(app)/history';
import Search from '../src/app/(app)/search';
import { fetchHistoryPage, fetchUsage } from '../src/lib/creditHistory';

// QA build 59: a new charge showed only after leaving and reopening Credit history, pull-to-refresh did nothing,
// and the in-app Search box capitalised the first letter.
let mockFocused: (() => void) | null = null;
jest.mock('expo-router', () => ({
    Link: ({ children }: any) => children,
    Stack: { Screen: () => null },
    useFocusEffect: (cb: () => void) => { mockFocused = cb; require('react').useEffect(cb, [cb]); },
}));
const mockApi = {};
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn().mockResolvedValue([]), fetchAllCatalog: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/lib/creditHistory', () => ({ ...jest.requireActual('../src/lib/creditHistory'), fetchHistoryPage: jest.fn(), fetchUsage: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.FlatList, RN.TextInput, RN.RefreshControl];
const entry = (id: string) => ({ id, delta: -5, reason: 'debit:job', createdAt: '2026-11-19T10:00:00Z', jobId: null, freeDelta: 0 });
jest.setTimeout(60000);
let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
    jest.mocked(fetchHistoryPage).mockReset().mockResolvedValue({ entries: [entry('a')] as any, next: null });
    jest.mocked(fetchUsage).mockReset().mockResolvedValue({ day: 0, week: 0, month: 0, truncated: false });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('history reloads when the screen comes back into focus', async () => {
    await act(async () => root.render(<History />));
    expect(fetchHistoryPage).toHaveBeenCalledTimes(1);
    await act(async () => { mockFocused?.(); });
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2);
});

test('pull-to-refresh reloads the history', async () => {
    await act(async () => root.render(<History />));
    const list = root.container.queryAll(n => n.props.refreshControl)[0];
    expect(list).toBeDefined();
    await act(async () => { list.props.refreshControl.props.onRefresh(); });
    expect(fetchHistoryPage).toHaveBeenCalledTimes(2);
});

test('the Search box does not capitalise', async () => {
    await act(async () => root.render(<Search />));
    const input = root.container.queryAll(n => n.props.returnKeyType === 'search')[0];
    expect(input.props.autoCapitalize).toBe('none');
});
