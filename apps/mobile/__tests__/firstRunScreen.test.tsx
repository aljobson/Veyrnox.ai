import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import FirstRun from '../src/app/(app)/first-run';
import { fetchCatalogCached, type CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
import { writeFirstGoal } from '../src/lib/firstGoalStore';
import { loadFirstOnboarding, replayFirstOnboarding, writeFirstOnboarding, writeFirstProfile } from '../src/lib/firstProfileStore';
import { markWelcomeSeen } from '../src/lib/markWelcomeSeen';
import { fetchPresets } from '../src/lib/presets';

// The first test pays for loading the screen and its modules cold, which can pass 5 s on a busy machine.
jest.setTimeout(20000);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockPrompt: CatalogModel = { id: 'prompt-image', name: 'Prompt image', modality: 'text-to-image', credits: 2, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({ ...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
jest.mock('../src/lib/firstGoalStore', () => ({ writeFirstGoal: jest.fn(async () => undefined) }));
jest.mock('../src/lib/firstProfileStore', () => ({ loadFirstOnboarding: jest.fn(), replayFirstOnboarding: jest.fn(async () => null), writeFirstOnboarding: jest.fn(async () => undefined), writeFirstProfile: jest.fn(async () => ({})) }));
jest.mock('../src/lib/markWelcomeSeen', () => ({ markWelcomeSeen: jest.fn(async () => undefined) }));
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: jest.fn() }));
jest.mock('../src/lib/presets', () => ({ fetchPresets: jest.fn(async () => []) }));
jest.mock('../src/auth/AuthProvider', () => { const api = { getBalance: async () => ({ free_credits: 10 }) }; const task = { user: 'A', gen: 1, current: () => true }; return { useAuth: () => ({ api, beginSessionTask: () => task }) }; });

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const windowDimensions = jest.spyOn(require('react-native'), 'useWindowDimensions');
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
    windowDimensions.mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    root = createRoot();
    for (const fn of [mockPush, mockReplace, writeFirstGoal, writeFirstProfile, writeFirstOnboarding, replayFirstOnboarding, markWelcomeSeen] as jest.Mock[]) fn.mockClear();
    jest.mocked(loadFirstOnboarding).mockReset().mockResolvedValue({ goal: null, role: null, destination: null, version: 1, currentStep: 'goal', completed: false });
    jest.mocked(fetchCatalogCached).mockReset().mockResolvedValue({ value: [mockPrompt], meta: { fromCache: false, stale: false, savedAt: Date.now(), ageMs: 0 } } as never);
    jest.mocked(fetchPresets).mockReset().mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
const start = () => press(t('welcome.go'));

test('asks the goal first (under Vey\'s hello), then where it will go, then the role, one per screen; each answer is saved on the phone and sent to the account', async () => {
    await act(async () => root.render(<FirstRun />));
    expect(hasText(t('create.firstGoal.title'))).toBe(true);
    expect(hasText(t('welcome.hello.title'))).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === t('create.firstGoal.title'))).toHaveLength(1);
    const goalCards = root.container.queryAll(n => n.props.testID === 'onboarding-choice-tile');
    expect(goalCards).toHaveLength(6);
    expect(goalCards.every(card => card.props.accessibilityRole === 'radio' && card.props.accessibilityState.checked === false)).toBe(true);
    const vividSurfaces = new Set(goalCards.map(card => RN.StyleSheet.flatten(card.props.style).backgroundColor));
    expect(vividSurfaces.size).toBeGreaterThanOrEqual(5);
    for (const card of goalCards) {
        const icon = card.queryAll(n => n.props.testID === 'onboarding-choice-icon')[0];
        const label = card.queryAll(n => n.props.testID === 'onboarding-choice-label')[0];
        expect(RN.StyleSheet.flatten(icon.props.style)).toMatchObject({ alignSelf: 'flex-end', width: 58, height: 58 });
        expect(icon.queryAll(n => {
            const style = RN.StyleSheet.flatten(n.props.style);
            return style?.width === 36 && style?.height === 36;
        })).toHaveLength(1);
        expect(RN.StyleSheet.flatten(label.props.style)).toMatchObject({ alignSelf: 'flex-start', marginTop: 'auto' });
    }
    await press(t('create.firstGoal.video'));
    expect(writeFirstGoal).toHaveBeenCalledWith('video');
    expect(replayFirstOnboarding).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ goal: 'video', completed: false, pending: true }));
    expect(hasText(t('create.firstRun.destTitle'))).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'onboarding-choice-tile')).toHaveLength(4);
    await press(t('create.firstRun.dest.reels'));
    expect(writeFirstProfile).toHaveBeenLastCalledWith({ destination: 'reels' });
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(true);
    expect(root.container.queryAll(n => n.props.testID === 'onboarding-choice-tile')).toHaveLength(5);
    expect(mockReplace).not.toHaveBeenCalled();
    await press(t('create.firstRun.role.creator'));
    expect(writeFirstProfile).toHaveBeenLastCalledWith({ role: 'creator' });
    // A creation goal ends on the recap, which names the idea; Start creating carries on.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(hasText(t('create.firstRun.suggested'))).toBe(true);
    await start();
    expect(mockReplace).toHaveBeenCalledWith('/');
});

test('account-backed resume loading is visible and named instead of presenting a blank screen', async () => {
    jest.mocked(loadFirstOnboarding).mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<FirstRun />));
    const progress = root.container.queryAll(n => n.props.accessibilityRole === 'progressbar' && n.props.accessibilityLabel === t('common.loading'));
    expect(progress).toHaveLength(1);
    expect(hasText(t('common.loading'))).toBe(true);
});

test('landscape AX journey keeps colourful choices inside both physical side insets', async () => {
    windowDimensions.mockReturnValue({ width: 844, height: 390, scale: 3, fontScale: 1.3 });
    await act(async () => {
        root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 59, bottom: 21, left: 59 }}><FirstRun /></SafeAreaInsetsContext.Provider>);
        await Promise.resolve(); await Promise.resolve();
    });
    const safeFrame = root.container.queryAll(node => {
        const style = RN.StyleSheet.flatten(node.props.style);
        return style?.paddingLeft === 59 && style?.paddingRight === 59 && style?.paddingBottom === 21;
    });
    expect(safeFrame).toHaveLength(1);
    const choices = root.container.queryAll(node => node.props.testID === 'onboarding-choice-row');
    expect(choices).toHaveLength(6);
    expect(choices.every(choice => RN.StyleSheet.flatten(choice.props.style).minHeight === 64)).toBe(true);
});

test('a goal card keeps its icon when a real template preview is available', async () => {
    jest.mocked(fetchPresets).mockResolvedValue([
        { id: 'image-preview', available: true, modality: 'text-to-image', posterUrl: 'https://example.invalid/onboarding.jpg' },
    ] as never);
    await act(async () => root.render(<FirstRun />));
    const image = labelled(t('create.firstGoal.image'))!;
    expect(image.queryAll(n => n.props.testID === 'onboarding-choice-icon')).toHaveLength(1);
    expect(image.queryAll(n => n.props.testID === 'onboarding-choice-label')).toHaveLength(1);
    const preview = image.queryAll(n => n.props.testID === 'onboarding-choice-photo')[0];
    expect(RN.StyleSheet.flatten(preview.props.style).opacity).toBeLessThan(0.5);
});

test('a creation goal opens that kind\'s starter form with the work example for a creator', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.image'));
    await press(t('create.firstRun.dest.youtube'));
    await press(t('create.firstRun.role.business'));
    await start();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'prompt-image', prompt: t('create.firstRun.example.work.image') } });
});

test('a hobbyist gets the everyday example, and Edit goes to its tab', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.audio'));
    await press(t('create.firstRun.dest.private'));
    await press(t('create.firstRun.role.hobbyist'));
    await start();
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ prompt: t('create.firstRun.example.work.audio') }) }));
    await act(async () => root.unmount());
    root = createRoot(); mockPush.mockClear();
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.edit'));
    await press(t('create.firstRun.dest.tiktok'));
    await press(t('create.firstRun.role.pro'));
    // Edit is an answered goal, so it ends on the recap (a sample before the paywall) and only Continue leaves it.
    expect(mockPush).not.toHaveBeenCalled();
    expect(hasText(t('create.firstRun.suggested'))).toBe(true);
    await start();
    expect(mockPush).toHaveBeenCalledWith('/editor');
});

test('every screen can be skipped; skipping all three records "skipped" and lands on the next screen', async () => {
    await act(async () => root.render(<FirstRun />));
    await skip(); await skip(); await skip();
    expect(writeFirstGoal).toHaveBeenCalledWith('skipped');
    expect(writeFirstProfile).toHaveBeenCalledWith({ destination: 'skipped' });
    expect(writeFirstProfile).toHaveBeenCalledWith({ role: 'skipped' });
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
});

test('an account that already answered is not asked again and goes straight on', async () => {
    jest.mocked(loadFirstOnboarding).mockResolvedValue({ goal: 'video', role: 'creator', destination: null, version: 1, currentStep: null, completed: true });
    await act(async () => root.render(<FirstRun />));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(false);
});

test('a partial account resumes at the authoritative step and completes through recap', async () => {
    jest.mocked(loadFirstOnboarding).mockResolvedValue({ goal: 'video', role: null, destination: 'youtube', version: 1, currentStep: 'role', completed: false });
    await act(async () => root.render(<FirstRun />));
    expect(hasText(t('create.firstRun.roleTitle'))).toBe(true);
    expect(hasText(t('create.firstGoal.title'))).toBe(false);
    await press(t('create.firstRun.role.creator'));
    expect(hasText(t('create.firstRun.suggested'))).toBe(true);
    await start();
    expect(replayFirstOnboarding).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ currentStep: 'recap', completed: false, pending: true, completeRequested: true }));
});

test('the welcome is marked seen only when the questions end, so quitting part-way brings them back next launch', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.video'));
    await press(t('create.firstRun.dest.reels'));
    expect(markWelcomeSeen).not.toHaveBeenCalled();
    await press(t('create.firstRun.role.creator'));
    expect(markWelcomeSeen).not.toHaveBeenCalled();
    await start();
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
});

test('an account that already answered is marked seen at once, so it is never looped back to the welcome', async () => {
    jest.mocked(loadFirstOnboarding).mockResolvedValue({ goal: null, role: 'skipped', destination: null, version: 0, currentStep: null, completed: true });
    await act(async () => root.render(<FirstRun />));
    expect(markWelcomeSeen).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
});

test('Back after a pick cancels the pending hop, and a real answer is not replaced by a skip', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.video'));
    // Pick a destination and go Back at once: the hop to the next question must not still fire.
    await act(async () => { labelled(t('create.firstRun.dest.reels'))!.props.onClick(event); });
    await act(async () => { labelled(t('public.vey.back'))!.props.onClick(event); jest.advanceTimersByTime(400); });
    expect(hasText(t('create.firstGoal.title'))).toBe(true);
    // Skipping the goal again keeps "video": nothing is written over it.
    jest.mocked(writeFirstGoal).mockClear();
    await skip();
    expect(writeFirstGoal).not.toHaveBeenCalledWith('skipped');
});

test('completion leaves immediately while failed background replay remains truthfully pending', async () => {
    jest.mocked(replayFirstOnboarding).mockImplementation(() => new Promise(() => {}));
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.image'));
    await press(t('create.firstRun.dest.youtube'));
    await press(t('create.firstRun.role.business'));
    await start();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(writeFirstOnboarding).toHaveBeenLastCalledWith('A', expect.objectContaining({ completed: false, pending: true, completeRequested: true }), expect.anything());
    expect(writeFirstOnboarding).not.toHaveBeenCalledWith('A', expect.objectContaining({ completed: true }), expect.anything());
});

test('tapping Start creating twice opens the starter form once', async () => {
    await act(async () => root.render(<FirstRun />));
    await press(t('create.firstGoal.image'));
    await press(t('create.firstRun.dest.youtube'));
    await press(t('create.firstRun.role.business'));
    await act(async () => { labelled(t('welcome.go'))!.props.onClick(event); labelled(t('welcome.go'))!.props.onClick(event); });
    expect(mockPush).toHaveBeenCalledTimes(1);
});
