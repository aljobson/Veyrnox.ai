import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import FirstRun from '../src/app/(app)/first-run';
import { fetchCatalogCached, type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
import { writeFirstGoal } from '../src/lib/firstGoalStore';
import { loadFirstAnswers, writeFirstProfile } from '../src/lib/firstProfileStore';
import { pushFirstAnswers } from '../src/lib/firstProfileSync';
import { markWelcomeSeen } from '../src/lib/markWelcomeSeen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockPrompt: CatalogModel = { id: 'prompt-image', name: 'Prompt image', modality: 'text-to-image', credits: 2, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
jest.mock('../src/lib/firstGoalStore', () => ({ writeFirstGoal: jest.fn(async () => undefined) }));
jest.mock('../src/lib/firstProfileStore', () => ({ loadFirstAnswers: jest.fn(), writeFirstProfile: jest.fn(async () => ({})) }));
jest.mock('../src/lib/markWelcomeSeen', () => ({ markWelcomeSeen: jest.fn(async () => undefined) }));
jest.mock('../src/lib/firstProfileSync', () => ({ pushFirstAnswers: jest.fn(async () => undefined) }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
jest.mock('../src/lib/presets', () => ({ fetchPresets: jest.fn(async () => []) }));
jest.mock('../src/auth/AuthProvider', () => { const api = {}; const task = { current: () => true }; return { useAuth: () => ({ api, beginSessionTask: () => task }) }; });

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
// Answers are radios now; Skip, Back and Start creating stay buttons.
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' || n.props.accessibilityRole === 'radio');
const labelled = (label: string) => buttons().find(n => n.props.accessibilityLabel === label);
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
// A chosen answer holds for a beat (so its tick shows) before the next question; the timers are advanced past it.
const press = async (label: string) => { await act(async () => { labelled(label)!.props.onClick(event); jest.advanceTimersByTime(400); }); };
const skip = () => press(t('create.firstGoal.skip'));

beforeEach(async () => {
    jest.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    for (const fn of [mockPush, mockReplace, writeFirstGoal, writeFirstProfile, pushFirstAnswers, markWelcomeSeen] as jest.Mock[]) fn.mockClear();
    jest.mocked(loadFirstAnswers).mockReset().mockResolvedValue({ goal: null, role: null, destination: null });
    jest.mocked(fetchCatalogCached).mockReset().mockResolvedValue({ value: [mockPrompt], meta: { fromCache: false, stale: false, savedAt: Date.now(), ageMs: 0 } } as never);
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
const start = () => press(t('welcome.go'));

test('asks the role, then the goal, then where it will go, one per screen; each answer is saved on the phone and sent to the account', async () => {
    await act(async () => root.render(<FirstRun />));
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(true);
    await press(t('create.firstRun.role.creator'));
    expect(writeFirstProfile).toHaveBeenCalledWith({ role: 'creator' });
    expect(pushFirstAnswers).toHaveBeenCalledWith(expect.anything(), { role: 'creator' });
    expect(hasText(t('create.firstGoal.title'))).toBe(true);
    await press(t('create.firstGoal.video'));
    expect(writeFirstGoal).toHaveBeenCalledWith('video');
    expect(hasText(t('create.firstRun.destTitle'))).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
    await press(t('create.firstRun.dest.reels'));
    expect(writeFirstProfile).toHaveBeenLastCalledWith({ destination: 'reels' });
    // A creation goal ends on the recap, which names the idea; Start creating carries on.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(hasText(t('create.firstRun.suggested'))).toBe(true);
    await start();
    expect(mockReplace).toHaveBeenCalledWith('/');
});

test('a creation goal opens that kind\'s starter form with the work example for a creator', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.business'));
    await press(t('create.firstGoal.image'));
    await press(t('create.firstRun.dest.youtube'));
    await start();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'prompt-image', prompt: t('create.firstRun.example.work.image') } });
});

test('a hobbyist gets the everyday example, and Edit goes to its tab', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.hobbyist'));
    await press(t('create.firstGoal.audio'));
    await press(t('create.firstRun.dest.private'));
    await start();
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ prompt: t('create.firstRun.example.work.audio') }) }));
    await act(async () => root.unmount());
    root = createRoot(); mockPush.mockClear();
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.pro'));
    await press(t('create.firstGoal.edit'));
    await press(t('create.firstRun.dest.tiktok'));
    expect(mockPush).toHaveBeenCalledWith('/editor');
});

test('every screen can be skipped; skipping all three records "skipped" and lands on the next screen', async () => {
    await act(async () => root.render(<FirstRun />));
    await skip(); await skip(); await skip();
    expect(writeFirstProfile).toHaveBeenCalledWith({ role: 'skipped' });
    expect(writeFirstGoal).toHaveBeenCalledWith('skipped');
    expect(writeFirstProfile).toHaveBeenCalledWith({ destination: 'skipped' });
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
});

test('an account that already answered is not asked again and goes straight on', async () => {
    jest.mocked(loadFirstAnswers).mockResolvedValue({ goal: 'video', role: 'creator', destination: null });
    await act(async () => root.render(<FirstRun />));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(false);
});

test('the welcome is marked seen only when the questions end, so quitting part-way brings them back next launch', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.creator'));
    await press(t('create.firstGoal.video'));
    expect(markWelcomeSeen).not.toHaveBeenCalled();
    await press(t('create.firstRun.dest.reels'));
    expect(markWelcomeSeen).not.toHaveBeenCalled();
    await start();
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
});

test('an account that already answered is marked seen at once, so it is never looped back to the welcome', async () => {
    jest.mocked(loadFirstAnswers).mockResolvedValue({ goal: null, role: 'skipped', destination: null });
    await act(async () => root.render(<FirstRun />));
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
});

test('Back after a pick cancels the pending hop, and a real answer is not replaced by a skip', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.creator'));
    // Pick a goal and go Back at once: the hop to the next question must not still fire.
    await act(async () => { labelled(t('create.firstGoal.video'))!.props.onClick(event); });
    await act(async () => { labelled(t('public.vey.back'))!.props.onClick(event); jest.advanceTimersByTime(400); });
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(true);
    // Skipping the role again keeps "creator": nothing is written over it.
    jest.mocked(writeFirstProfile).mockClear();
    await skip();
    expect(writeFirstProfile).not.toHaveBeenCalledWith({ role: 'skipped' });
});

test('account writes go out in order, one after another', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    jest.mocked(pushFirstAnswers).mockImplementationOnce(() => new Promise<void>((resolve) => { release = () => { order.push('role-done'); resolve(); }; }));
    jest.mocked(pushFirstAnswers).mockImplementation(async (_api, a) => { order.push(Object.keys(a)[0]); });
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstRun.role.creator'));
    await press(t('create.firstGoal.video'));
    expect(order).toEqual([]);
    await act(async () => { release(); });
    expect(order).toEqual(['role-done', 'goal']);
});
