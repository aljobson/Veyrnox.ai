import * as SecureStore from 'expo-secure-store';
import {
    completeNotificationPrimer,
    markNotificationPrimerPending,
    readNotificationPrimer,
    subscribeNotificationPrimer,
} from '../src/lib/notificationPrimer';

const SLOT = 'veyrnox.notificationPrimer.v1';
const mockDisk = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }),
}));

beforeEach(() => {
    mockDisk.clear();
    jest.clearAllMocks();
});

test.each([undefined, null, '', '{bad', 'null', '[]'])('missing or malformed state is safe: %s', async raw => {
    if (typeof raw === 'string') mockDisk.set(SLOT, raw);
    await expect(readNotificationPrimer()).resolves.toEqual({ pending: false, shown: false });
});

test('only a successful long-running generation makes the contextual primer pending', async () => {
    await markNotificationPrimerPending('image');
    await markNotificationPrimerPending('edit');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();

    await markNotificationPrimerPending('video');
    expect(await readNotificationPrimer()).toEqual({ pending: true, shown: false });
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);

    await markNotificationPrimerPending('audio');
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

test('viewing or declining the explanation is respected across later jobs and restarts', async () => {
    const changed = jest.fn();
    const unsubscribe = subscribeNotificationPrimer(changed);
    await markNotificationPrimerPending('speech');
    await completeNotificationPrimer();
    unsubscribe();

    expect(changed).toHaveBeenCalledTimes(2);
    expect(await readNotificationPrimer()).toEqual({ pending: false, shown: true });
    await markNotificationPrimerPending('music');
    await markNotificationPrimerPending('sound');
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockDisk.get(SLOT)!)).toEqual({ pending: false, shown: true });
});
