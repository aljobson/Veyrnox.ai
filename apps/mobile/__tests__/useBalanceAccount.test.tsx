import { act, useEffect } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { useBalance } from '../src/lib/useBalance';
let mockOwner = 'A';
const mockUsers = new Set<() => void>(), mockPublish = new Set<(owner: string, balance: number) => void>();
const mockReads: any[] = [];
const mockApi = { getBalance: jest.fn() };
let mockFocus: () => void;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => { mockFocus = fn; jest.requireActual('react').useEffect(fn, [fn]); } }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockUsers.add(fn); return () => mockUsers.delete(fn); }, appCache: { swr: (options: any) => { mockReads.push(options); return Promise.resolve(); } } }));
jest.mock('../src/lib/balanceEvents', () => ({ subscribeBalance: (fn: (owner: string, balance: number) => void) => { mockPublish.add(fn); return () => mockPublish.delete(fn); } }));
let root: Root, shown: number | null;
const renders: (number | null)[] = [];
function Hook() { shown = useBalance(); renders.push(shown); return null; }
beforeEach(async () => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mockOwner = 'A'; mockReads.length = 0; renders.length = 0; root = createRoot(); await act(async () => root.render(<Hook />)); });
afterEach(async () => { await act(async () => root.unmount()); });
test('account switch clears balance and rejects A reads while focused B reads immediately', async () => {
    await act(async () => mockReads[0].onData({ balance: 8 })); expect(shown).toBe(8);
    await act(async () => mockFocus()); const old = mockReads[1];
    await act(async () => { mockOwner = 'B'; mockUsers.forEach(fn => fn()); }); expect(shown).toBeNull();
    expect(mockReads[2].userId).toBe('B');
    await act(async () => old.onData({ balance: 99 })); expect(shown).toBeNull();
    await act(async () => mockReads[2].onData({ balance: 5 })); expect(shown).toBe(5);
});
test('only the latest started read applies; a publication supersedes reads', async () => {
    await act(async () => mockFocus());
    await act(async () => mockReads[1].onData({ balance: 12 }));
    await act(async () => mockReads[0].onData({ balance: 99 })); expect(shown).toBe(12);
    await act(async () => mockPublish.forEach(fn => fn('A', 3)));
    await act(async () => mockReads[1].onData({ balance: 99 })); expect(shown).toBe(3);
});
test('unmounted hooks ignore pending reads and unsubscribe', async () => {
    await act(async () => root.unmount()); const before = [...renders];
    await act(async () => mockReads[0].onData({ balance: 99 }));
    expect(renders).toEqual(before); expect(mockUsers.size).toBe(0); expect(mockPublish.size).toBe(0);
});
