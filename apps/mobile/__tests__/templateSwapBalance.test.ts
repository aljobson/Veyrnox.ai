let mockOwner: string | null = 'a';
const mockPublish = jest.fn();
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/balanceEvents', () => ({ publishBalance: (...args: unknown[]) => mockPublish(...args) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({}) }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn() }));
import { refreshBalanceAfterSwap } from '../src/lib/templateSwap/runtime';

beforeEach(() => { mockOwner = 'a'; mockPublish.mockClear(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('a swap that changes the balance publishes the fresh balance for the current owner', async () => {
    refreshBalanceAfterSwap({ getBalance: async () => ({ balance: 120 }) });
    await flush();
    expect(mockPublish).toHaveBeenCalledWith('a', 120);
});

test('a balance read that resolves after the account changed is dropped, and a failed read publishes nothing', async () => {
    refreshBalanceAfterSwap({ getBalance: async () => { mockOwner = 'b'; return { balance: 5 }; } });
    await flush();
    expect(mockPublish).not.toHaveBeenCalled();
    refreshBalanceAfterSwap({ getBalance: async () => { throw new Error('offline'); } });
    await flush();
    expect(mockPublish).not.toHaveBeenCalled();
    mockOwner = null;
    const getBalance = jest.fn(async () => ({ balance: 1 }));
    refreshBalanceAfterSwap({ getBalance });
    expect(getBalance).not.toHaveBeenCalled();
});
