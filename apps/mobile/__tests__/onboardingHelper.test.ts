import { openFirstRun, openSignedIn } from '../tests/helpers';
import type { App, Screen } from 'e2e';

type Stage = 'home' | 'language' | 'sign-in' | 'consent' | 'welcome' | 'start' | 'first-run' | 'loading';
let stage: Stage, checked: boolean, freshJourney: boolean;
const taps: string[] = [];
const app = { open: jest.fn(async () => {}), clearState: jest.fn(async () => { freshJourney = true; stage = 'language'; }) } as unknown as App;
const screen = { getByRole: (role: string, name: string, options?: { selected?: boolean }) => ({
    isVisible: async () => name === 'Explore' ? stage === 'home' && options?.selected === true
        : name === 'English' ? stage === 'language'
        : role === 'checkbox' ? stage === 'sign-in'
        : name === 'Decline' ? stage === 'consent'
        : role === 'radiogroup' && name === 'What do you want to make first?' ? stage === 'first-run'
        : name === 'Skip' ? stage === 'welcome'
        : name === 'Skip for now' ? stage === 'start' : false,
    isChecked: async () => checked,
    tap: async () => {
        taps.push(name);
        if (role === 'checkbox') checked = true;
        else if (name === 'Continue') stage = 'sign-in';
        else if (name === 'Preview with demo data') { stage = 'home'; setTimeout(() => { stage = 'consent'; }, 750); }
        else if (name === 'Decline') stage = freshJourney ? 'first-run' : 'welcome';
        else if (name === 'Skip') stage = 'start';
        else if (name === 'Skip for now') stage = 'home';
    },
}) } as unknown as Screen;
beforeEach(() => { jest.useFakeTimers(); stage = 'language'; checked = false; freshJourney = false; taps.length = 0; jest.mocked(app.clearState).mockClear(); });
afterEach(() => jest.useRealTimers());
test('handles every first-run screen and waits through momentary Explore', async () => {
    let done = false;
    const pending = openSignedIn(app, screen).then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(1500);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(5000); await pending;
    expect(taps).toEqual(['English', 'Continue', 'I am 18 or older and agree to the Terms and Privacy Policy.', 'Preview with demo data', 'Decline', 'Skip', 'Skip for now']);
    expect(stage).toBe('home');
});
test('already signed in still requires two seconds of stable selected Explore', async () => {
    stage = 'home'; let done = false;
    const pending = openSignedIn(app, screen).then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(1999); expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1); await pending;
    expect(done).toBe(true); expect(taps).toEqual([]);
});
test('fresh first-run helper clears local state and stops at the goal question without skipping it', async () => {
    let done = false;
    const pending = openFirstRun(app, screen).then(() => { done = true; });
    await jest.advanceTimersByTimeAsync(3000); await pending;
    expect(done).toBe(true);
    expect(app.clearState).toHaveBeenCalledTimes(1);
    expect(taps).toEqual(['English', 'Continue', 'I am 18 or older and agree to the Terms and Privacy Policy.', 'Preview with demo data', 'Decline']);
    expect(stage).toBe('first-run');
});
test('missing onboarding and home screens fail within the overall timeout', async () => {
    stage = 'loading';
    const check = expect(openSignedIn(app, screen)).rejects.toThrow('within 60 seconds');
    await jest.advanceTimersByTimeAsync(60_000); await check;
});
