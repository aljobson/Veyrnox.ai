import * as SecureStore from 'expo-secure-store';
import { writeFirstGoal } from '../src/lib/firstGoalStore';
import { replayFirstOnboarding, writeFirstOnboarding, writeFirstProfile } from '../src/lib/firstProfileStore';
import { pushFirstAnswers } from '../src/lib/firstProfileSync';
import {
    PRE_AUTH_ONBOARDING_SLOT,
    applyPendingPreAuthOnboarding,
    browsePreAuthOnboarding,
    completePreAuthOnboarding,
    parsePreAuthOnboarding,
    readPreAuthOnboarding,
    savePreAuthAnswers,
} from '../src/lib/preAuthOnboarding';
import type { ClientTask } from '../src/lib/api';

const mockDisk = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { mockDisk.set(key, value); }),
}));
jest.mock('../src/lib/firstGoalStore', () => ({ writeFirstGoal: jest.fn(async () => undefined) }));
jest.mock('../src/lib/firstProfileStore', () => ({
    writeFirstProfile: jest.fn(async () => undefined),
    writeFirstOnboarding: jest.fn(async () => undefined),
    replayFirstOnboarding: jest.fn(async () => null),
}));
jest.mock('../src/lib/firstProfileSync', () => ({ pushFirstAnswers: jest.fn(async () => undefined) }));

const answers = { role: 'creator' as const, goal: 'video' as const, destination: 'youtube' as const };

beforeEach(() => {
    mockDisk.clear();
    jest.clearAllMocks();
});

test.each([null, '', '{bad', '[]', '{}', '{"version":2}', '{"version":1,"role":"private"}'])('malformed or unknown state resumes safely: %s', raw => {
    expect(parsePreAuthOnboarding(raw)).toEqual({ role: null, goal: null, destination: null, completed: false, pending: false, resume: 'sign-in' });
});

test('partial answers survive a restart without claiming a completed result', async () => {
    await savePreAuthAnswers({ role: 'business' });
    expect(await readPreAuthOnboarding()).toEqual({ role: 'business', goal: null, destination: null, completed: false, pending: false, resume: 'sign-in' });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(PRE_AUTH_ONBOARDING_SLOT, expect.stringContaining('"role":"business"'));
});

test('guest browsing remembers the route and only carries a complete result into a later account', async () => {
    await browsePreAuthOnboarding();
    expect(await readPreAuthOnboarding()).toMatchObject({ completed: true, pending: false, resume: 'preview' });

    mockDisk.clear();
    await savePreAuthAnswers(answers);
    await browsePreAuthOnboarding();
    expect(await readPreAuthOnboarding()).toEqual({ ...answers, completed: true, pending: true, resume: 'preview' });
});

test('a completed result is applied once and retires the older account onboarding across restarts', async () => {
    await completePreAuthOnboarding(answers, 'sign-in');
    const request = jest.fn(async () => ({}));
    const task: ClientTask = { gen: 4, user: 'account-a', current: () => true };

    await expect(applyPendingPreAuthOnboarding({ request }, task)).resolves.toBe(true);
    expect(writeFirstGoal).toHaveBeenCalledWith('video');
    expect(writeFirstProfile).toHaveBeenCalledWith({ role: 'creator', destination: 'youtube' });
    expect(pushFirstAnswers).toHaveBeenCalledWith({ request }, answers);
    expect(writeFirstOnboarding).toHaveBeenCalledWith('account-a', expect.objectContaining({
        ...answers, currentStep: 'recap', completed: false, pending: true, completeRequested: true,
    }), task);
    expect(replayFirstOnboarding).toHaveBeenCalledWith({ request }, task, expect.objectContaining({ completeRequested: true }));
    expect(await readPreAuthOnboarding()).toEqual({ ...answers, completed: true, pending: false, resume: 'sign-in' });
    await expect(applyPendingPreAuthOnboarding({ request }, task)).resolves.toBe(false);
    expect(writeFirstGoal).toHaveBeenCalledTimes(1);
});
