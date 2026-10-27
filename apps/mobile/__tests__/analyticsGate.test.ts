jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ appStorage: { get: jest.fn().mockResolvedValue(null) } }));
afterEach(() => { delete process.env.EXPO_PUBLIC_POSTHOG_KEY; });
async function setup(seen: boolean, choice: string | null, enabled = true) {
    jest.resetModules();
    if (enabled) process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test'; else delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    const secure = require('expo-secure-store');
    const { FIRST_RUN_SLOT, serializeSeen } = require('../src/lib/firstRun');
    secure.getItemAsync.mockImplementation(async (key: string) => key === FIRST_RUN_SLOT ? seen ? serializeSeen() : null : choice ? JSON.stringify({ v: 1, choice, at: 1 }) : null);
    return require('../src/lib/firstRunPending');
}
test.each([false, true])('undecided, seen=%s: consent then correct destination, once per launch', async seen => {
    const gate = await setup(seen, null);
    expect(gate.isFirstRunPending()).toBe(true);
    expect(await gate.firstRunDestination()).toBe('/analytics-consent');
    expect(await gate.firstRunDestination()).toBeNull();
    expect(gate.isFirstRunPending()).toBe(true); // Includes native policy navigation.
    expect(gate.afterAnalyticsChoice()).toBe(seen ? '/' : '/welcome');
    expect(gate.isFirstRunPending()).toBe(!seen);
});
test.each(['granted', 'denied'])('decided %s preserves welcome logic', async choice => {
    let gate = await setup(false, choice);
    expect(await gate.firstRunDestination()).toBe('/welcome');
    gate = await setup(true, choice);
    expect(await gate.firstRunDestination()).toBeNull();
    expect(gate.isFirstRunPending()).toBe(false);
});
test('kill switch bypasses consent', async () => {
    const gate = await setup(false, null, false);
    expect(await gate.firstRunDestination()).toBe('/welcome');
});

test('sign-out releases suppression and another user recomputes the gate', async () => {
    const gate = await setup(false, 'denied');
    gate.setFirstRunUser('first');
    expect(await gate.firstRunDestination()).toBe('/welcome');
    expect(gate.isFirstRunPending()).toBe(true);
    gate.setFirstRunUser(null);
    expect(gate.isFirstRunPending()).toBe(false);
    gate.setFirstRunUser('second');
    expect(gate.isFirstRunPending()).toBe(true);
    // Welcome was already claimed this launch, so the gate releases the modals.
    expect(await gate.firstRunDestination()).toBeNull();
    expect(gate.isFirstRunPending()).toBe(false);
});

test('a direct account switch recomputes without replaying checks for token refresh', async () => {
    const gate = await setup(true, 'denied');
    gate.setFirstRunUser('first');
    await gate.firstRunDestination();
    gate.setFirstRunUser('first');
    expect(gate.isFirstRunPending()).toBe(false);
    gate.setFirstRunUser('second');
    expect(gate.isFirstRunPending()).toBe(true);
    expect(await gate.firstRunDestination()).toBeNull();
    expect(gate.isFirstRunPending()).toBe(false);
});

test('a stale read cannot redirect or suppress modals after sign-out', async () => {
    const gate = await setup(false, null);
    gate.setFirstRunUser('first');
    let finish!: (value: null) => void;
    require('expo-secure-store').getItemAsync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const destination = gate.firstRunDestination();
    gate.setFirstRunUser(null);
    finish(null);
    expect(await destination).toBeNull();
    expect(gate.isFirstRunPending()).toBe(false);
});
