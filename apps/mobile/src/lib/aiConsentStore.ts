import * as SecureStore from 'expo-secure-store';
import { createConsentGate, type ConsentStorage } from './aiConsent';

// SecureStore keys allow letters, digits, '.', '-' and '_': the key is built from a version and a user id, which
// are both of that kind. The record outlives sign-out on purpose, so the same person is not asked again.
const secureStorage: ConsentStorage = {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
};

export const aiConsent = createConsentGate(secureStorage);
