import * as SecureStore from 'expo-secure-store';
import { readRefreshToken, SessionReadError } from '../src/lib/auth/sessionStore';
afterEach(() => jest.restoreAllMocks());
test.each([null, ''])('missing or reinstall-blanked token %p is absent', async value => {
    jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(value);
    await expect(readRefreshToken()).resolves.toBeNull();
});
test('a Keychain read failure throws a typed error without deleting or exposing the token', async () => {
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('sensitive native details'));
    const remove = jest.spyOn(SecureStore, 'deleteItemAsync');
    await expect(readRefreshToken()).rejects.toBeInstanceOf(SessionReadError);
    await expect(readRefreshToken()).rejects.toThrow('session_read_failed');
    expect(remove).not.toHaveBeenCalled();
});
