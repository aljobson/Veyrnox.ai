const mockStore = new Map<string, string>();
let mockOwner: string | undefined = 'a';
const mockUsers = new Set<() => void>();
const mockSuccess = jest.fn();
jest.mock('expo-secure-store', () => ({ getItem: (key: string) => mockStore.get(key) ?? null, setItem: (key: string, value: string) => mockStore.set(key, value) }));
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => mockOwner,
    subscribeCacheUser: (fn: () => void) => {
        mockUsers.add(fn);
        return () => mockUsers.delete(fn);
    },
}));
jest.mock('../src/lib/haptics', () => ({ playSuccess: () => mockSuccess() }));
import type { Job } from '../src/lib/media';
import type { CelebrationEvent } from '../src/lib/veyMotion';
const job = (job_id: string, state: Job['state']): Job => ({ job_id, state, credits: 5, model_id: 'm', has_asset: state === 'succeeded', created_at: new Date().toISOString() });
let c: typeof import('../src/lib/celebrate');
let events: CelebrationEvent[];
let off: () => void;
function boot(ack = true) {
    jest.resetModules();
    mockUsers.clear();
    c = require('../src/lib/celebrate');
    events = [];
    off = require('../src/lib/veyMotion').onCelebrate((event: CelebrationEvent) => {
        events.push(event);
        if (ack) event.onShown();
    });
}
beforeEach(() => {
    mockStore.clear();
    mockSuccess.mockClear();
    mockOwner = 'a';
    boot();
});
afterEach(() => {
    events.forEach((e) => e.onDone());
    off();
    jest.useRealTimers();
});
test('historical and recent other-device Library results never consume a milestone', () => {
    expect(c.celebrateOutput('remote', 'video/mp4', false).big).toBe(false);
    expect(c.celebrateFinished([job('remote', 'succeeded')], async () => ({ mime_type: 'video/mp4' }))).toBe(0);
    expect(events).toHaveLength(0);
    expect(mockStore.get('veyrnox.celebrate.first.v1')).toBeUndefined();
});
test('first creation and first video fire once, later completions stay small', () => {
    const first = c.celebrateOutput('one', 'image/png', true);
    expect(first.big).toBe(true);
    expect(events[0].kind).toBe('firstCreation');
    events[0].onDone();
    expect(c.celebrateOutput('two', 'image/png', true).big).toBe(false);
    expect(c.celebrateOutput('three', 'video/mp4', true).big).toBe(true);
    expect(events[1].kind).toBe('firstVideo');
    events[1].onDone();
    expect(c.celebrateOutput('four', 'video/mp4', true).big).toBe(false);
    expect(events).toHaveLength(2);
    off();
    boot();
    expect(c.celebrateOutput('five', 'video/mp4', true).big).toBe(false);
});
test('the onboarding milestone shares the first-creation claim', () => {
    c.noteOnboardingCompleted();
    c.celebrateOutput('one', 'image/png', true);
    expect(events[0].kind).toBe('afterOnboarding');
    events[0].onDone();
    expect(c.celebrateOutput('two', 'image/png', true).big).toBe(false);
});
test('the host must acknowledge display before any flag is saved', () => {
    off();
    boot(false);
    c.celebrateOutput('one', 'video/mp4', true);
    expect(mockStore.get('veyrnox.celebrate.first.v1')).toBeUndefined();
    events[0].onDone();
    expect(mockStore.get('veyrnox.celebrate.video.v1')).toBeUndefined();
});
test('local submission already succeeded at first poll is eligible and dedupes both paths', async () => {
    c.noteLocalSubmission('one');
    c.celebrateFinished([job('one', 'succeeded')], async () => ({ mime_type: 'video/mp4' }));
    await Promise.resolve();
    await Promise.resolve();
    const result = c.celebrateOutput('one', 'video/mp4', false);
    expect(result.big).toBe(true);
    expect(events).toHaveLength(1);
    events[0].onDone();
    await result.done;
    c.celebrateFinished([job('one', 'succeeded')], async () => ({ mime_type: 'video/mp4' }));
    expect(events).toHaveLength(1);
});
test('inaccessible or aborted output consumes no flag', async () => {
    c.noteLocalSubmission('bad');
    c.celebrateFinished([job('bad', 'succeeded')], async () => {
        throw Error('denied');
    });
    const abort = new AbortController();
    abort.abort();
    c.noteLocalSubmission('gone');
    c.celebrateFinished([job('gone', 'succeeded')], async () => ({ mime_type: 'image/png' }), abort.signal);
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(0);
    expect(mockStore.get('veyrnox.celebrate.first.v1')).toBeUndefined();
});
test('restart restores only local unexpired evidence; list is bounded and pruned at lookup', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    c.noteLocalSubmission('one');
    off();
    boot();
    expect(c.celebrateOutput('one', 'image/png', false).big).toBe(true);
    events[0].onDone();
    c.noteLocalSubmission('expired');
    jest.setSystemTime(1_000_000 + 86_400_001);
    off();
    boot();
    expect(c.celebrateOutput('expired', 'video/mp4', false).big).toBe(false);
    for (let i = 0; i < 70; i++) c.noteLocalSubmission(String(i));
    const list = JSON.parse(mockStore.get(c.SUBMISSIONS_SLOT)!);
    expect(list).toHaveLength(50);
    expect(list[0].jobId).toBe('20');
    jest.advanceTimersByTime(86_400_001);
    expect(c.celebrateOutput('69', 'video/mp4', false).big).toBe(false);
    expect(JSON.parse(mockStore.get(c.SUBMISSIONS_SLOT)!)).toEqual([]);
});
test('account changes and sign-out discard local submissions, while milestones stay per phone', () => {
    c.noteLocalSubmission('one');
    mockOwner = 'b';
    mockUsers.forEach((fn) => fn());
    expect(c.celebrateOutput('one', 'image/png', false).big).toBe(false);
    c.noteLocalSubmission('two');
    mockOwner = undefined;
    mockUsers.forEach((fn) => fn());
    expect(c.celebrateOutput('two', 'image/png', false).big).toBe(false);
});
test('rating waits for done, uses the existing delay otherwise, and never fires after abort', async () => {
    jest.useFakeTimers();
    const push = jest.fn();
    const controller = new AbortController();
    const first = c.celebrateOutput('one', 'image/png', true);
    c.afterCelebration(first, 2000, controller.signal, push);
    jest.advanceTimersByTime(4000);
    expect(push).not.toHaveBeenCalled();
    events[0].onDone();
    await Promise.resolve();
    jest.advanceTimersByTime(1999);
    expect(push).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(push).toHaveBeenCalledTimes(1);
    push.mockClear();
    const small = c.celebrateOutput('two', 'image/png', true);
    const cancel = c.afterCelebration(small, 2000, controller.signal, push);
    jest.advanceTimersByTime(1999);
    expect(push).not.toHaveBeenCalled();
    cancel();
    jest.advanceTimersByTime(3000);
    expect(push).not.toHaveBeenCalled();
    c.afterCelebration(small, 2000, controller.signal, push);
    controller.abort();
    jest.runAllTimers();
    expect(push).not.toHaveBeenCalled();
});
test('unmount while a big celebration is pending cancels the rating continuation', async () => {
    const push = jest.fn(),
        controller = new AbortController();
    const result = c.celebrateOutput('one', 'video/mp4', true);
    c.afterCelebration(result, 2000, controller.signal, push);
    controller.abort();
    events[0].onDone();
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
});
