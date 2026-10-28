import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Chip, SegmentedControl, TextField, AppearanceContext } from '../src/components/ui';
import { CinemaPlayer } from '../src/components/cinema/CinemaPlayer';
import { TitleCard } from '../src/components/cinema/TitleCard';
import { DEFAULT_APPEARANCE, tokensForScheme } from '../src/theme';
import { chooseLocale, t } from '../src/lib/i18n';

const mockListeners: Record<string, (event: any) => void> = {};
const mockPlayer = { playing: false, currentTime: 0, duration: 120, play: jest.fn(), pause: jest.fn(), addListener: jest.fn((name: string, callback: (event: any) => void) => { mockListeners[name] = callback; return { remove: jest.fn() }; }) };
const mockApi = {}, mockToken = jest.fn();
const mockSession = { start: jest.fn(), stop: jest.fn(), setVisible: jest.fn(), setPlaying: jest.fn(), tick: jest.fn(), fail: jest.fn() };
let mockState: (state: any) => void;
jest.mock('expo-router', () => ({ Link: 'Link', useFocusEffect: jest.fn() }));
jest.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: () => mockPlayer }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, getAccessToken: mockToken }) }));
jest.mock('../src/lib/cinemaProgress', () => ({ getCinemaProgress: () => ({ recorder: jest.fn() }) }));
jest.mock('../src/lib/cinemaPlayback', () => ({ BLOCK_COPY: {}, createPlaybackSession: ({ onState }: any) => { mockState = onState; return mockSession; } }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ActivityIndicator];
let root: Root;
const style = (n: any) => RN.StyleSheet.flatten(n.props.style) ?? {};
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); root = createRoot(); chooseLocale('en'); });
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); chooseLocale('en'); });

test('selected chips have a stable inset outline and primary caption in Light Mint', async () => {
    const appearance = { ...DEFAULT_APPEARANCE, theme: 'light' as const, accent: 'mint' as const };
    const p = tokensForScheme('light', appearance);
    const render = async (selected: boolean) => act(async () => root.render(<AppearanceContext value={appearance}><Chip label="Choice" selected={selected} onPress={jest.fn()} /></AppearanceContext>));
    await render(false);
    const before = root.container.queryAll(n => style(n).borderRadius && style(n).paddingHorizontal)[0];
    const geometry = { padding: style(before).paddingHorizontal, height: style(before).minHeight };
    await render(true);
    const outline = root.container.queryAll(n => n.props.pointerEvents === 'none' && style(n).borderWidth === 2)[0];
    expect(style(outline)).toMatchObject({ position: 'absolute', borderColor: p.textPrimary });
    const selected = root.container.queryAll(n => style(n).backgroundColor === p.accentSubtle)[0];
    expect({ padding: style(selected).paddingHorizontal, height: style(selected).minHeight }).toEqual(geometry);
    expect(root.container.queryAll(n => n.children.includes('Choice') && style(n).color === p.textPrimary).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityState?.selected === true).length).toBeGreaterThan(0);
});

test('selected segments have an inset outline and bold label', async () => {
    await act(async () => root.render(<SegmentedControl options={[{ value: 'a', label: 'First' }, { value: 'b', label: 'Second' }]} value="b" onChange={jest.fn()} />));
    const chosen = root.container.queryAll(n => n.props.accessibilityRole === 'tab' && n.props.accessibilityState.selected)[0];
    expect(chosen.queryAll(n => style(n).borderWidth === 2 && style(n).position === 'absolute').length).toBeGreaterThan(0);
    expect(chosen.queryAll(n => n.children.includes('Second') && style(n).fontWeight === '700').length).toBeGreaterThan(0);
});

test('a focused TextField has the current error in its accessible name, preserving caller labels', async () => {
    await act(async () => root.render(<TextField label="Email" accessibilityLabel="Contact email" error="Enter a valid email" />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Contact email, Enter a valid email').length).toBeGreaterThan(0);
    await act(async () => root.render(<TextField label="Email" accessibilityLabel="Contact email" />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Contact email').length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel?.includes('valid email'))).toHaveLength(0);
});

test('Arabic accessibility names retain raw names while display copy uses isolation', async () => {
    chooseLocale('ar');
    const display = t('account.contact', { email: 'a@example.com' });
    expect(display).toContain('\u2068');
    await act(async () => root.render(<Chip label={display} onPress={jest.fn()} />));
    const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel)[0];
    expect(button.props.accessibilityLabel).toContain('a@example.com');
    expect(button.props.accessibilityLabel).not.toMatch(/[\u2068\u2069]/);
});

test('Cinema control tracks play/pause and position/duration, and announces loading', async () => {
    const announce = jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    await act(async () => root.render(<CinemaPlayer contentId="title" />));
    const button = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityValue)[0];
    expect(button().props.accessibilityLabel).toBe('Play');
    expect(button().props.accessibilityState.busy).toBe(true);
    expect(announce).toHaveBeenCalledWith(t('cinemaUpload.loading'));
    await act(async () => { mockState({ kind: 'playing' }); mockListeners.playingChange({ isPlaying: true }); mockListeners.timeUpdate({ currentTime: 35 }); });
    expect(button().props.accessibilityLabel).toBe('Pause');
    expect(button().props.accessibilityValue.text).toBe('35 / 120');
    expect(button().props.accessibilityState.busy).toBe(false);
    await act(async () => mockListeners.playingChange({ isPlaying: false }));
    expect(button().props.accessibilityLabel).toBe('Play');
    await act(async () => mockListeners.statusChange({ status: 'loading' }));
    expect(button().props.accessibilityState.busy).toBe(true);
});

test('Cinema poster scrim keeps small text above 4.5:1 even on white', async () => {
    await act(async () => root.render(<TitleCard item={{ id: 'title', title: 'Title', creator: 'Creator', synopsis: 'Synopsis', contentType: 'FILM', durationSeconds: 60 } as never} height={800} playing={false} onPlay={jest.fn()} onOpen={jest.fn()} onReport={jest.fn()} />));
    const shade = root.container.queryAll(n => /^rgba\(10,10,11,/.test(style(n).backgroundColor ?? ''))[0];
    const alpha = Number(style(shade).backgroundColor.match(/[\d.]+/g).at(-1));
    const lum = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const background = lum([10, 10, 11].map(c => c * alpha + 255 * (1 - alpha)));
    expect((lum([212, 212, 216]) + .05) / (background + .05)).toBeGreaterThanOrEqual(4.5);
});
