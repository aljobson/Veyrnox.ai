import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Agent from '../src/app/(app)/create/agent';
import { requestPlan, approvePlan, type Plan } from '../src/lib/montage';
import { t } from '../src/lib/i18n';
import { DEFAULT_APPEARANCE, tokensForScheme } from '../src/theme';
import { AppearanceContext } from '../src/components/ui';

const mockReplace = jest.fn();
const mockApi = {};
let mockBalance = 100;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => ({ replace: mockReplace }), useFocusEffect: (fn: any) => require('react').useEffect(fn, []) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/montage', () => ({ ...jest.requireActual('../src/lib/montage'), requestPlan: jest.fn(), approvePlan: jest.fn() }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ActivityIndicator];
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
let root: Root;
let plan: Plan;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const planLabel = `${t('videoAgent.plan')}, free`;
const approvalLabel = () => t('videoAgent.approve', { credits: String(plan.credits) });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    mockReplace.mockClear();
    mockBalance = 100;
    plan = { planId: 'plan', idempotencyKey: 'key', seconds: 10, summary: 'A calm film', credits: 20,
        aspect: '9:16', narrationText: 'Exact words', expiresAt: Math.floor(Date.now() / 1000) + 1800 };
    jest.mocked(requestPlan).mockReset().mockImplementation(async () => plan);
    jest.mocked(approvePlan).mockReset().mockResolvedValue('job');
});
afterEach(async () => { await act(async () => root.unmount()); });
async function render() {
    await act(async () => root.render(<AppearanceContext.Provider value={{ ...DEFAULT_APPEARANCE, theme: 'light' }}><Agent /></AppearanceContext.Provider>));
}
async function fill() {
    await act(async () => control(t('videoAgent.briefLabel')).props.onChangeText('A calm sunrise over the sea'));
    await act(async () => control(t('videoAgent.narration')).props.onChangeText('Exact words'));
}
async function makePlan() { await act(async () => control(planLabel).props.onClick(event)); }

test('planning keeps field constraints and hands the primary emphasis to approval without charging early', async () => {
    await render();
    expect(control(t('videoAgent.briefLabel')).props).toMatchObject({ multiline: true, maxLength: 500, editable: true });
    expect(control(t('videoAgent.narration')).props).toMatchObject({ multiline: true, maxLength: 300, editable: true });
    expect(control(planLabel).props.accessibilityState.disabled).toBe(true);
    await fill();
    const p = tokensForScheme('light');
    expect(RN.StyleSheet.flatten(control(planLabel).props.style).backgroundColor).toBe(p.accent);
    await makePlan();
    expect(requestPlan).toHaveBeenCalledWith(mockApi, 'A calm sunrise over the sea', '9:16', 'Exact words');
    expect(approvePlan).not.toHaveBeenCalled();
    expect(RN.StyleSheet.flatten(control(planLabel).props.style).backgroundColor).toBe(p.surface);
    expect(RN.StyleSheet.flatten(control(approvalLabel()).props.style).backgroundColor).toBe(p.accent);
    const price = root.container.queryAll(n => n.children.includes('20'))[0];
    const balance = root.container.queryAll(n => n.children.includes('100'))[0];
    expect(RN.StyleSheet.flatten(price.props.style)).toMatchObject({ color: p.warning, fontVariant: ['tabular-nums'] });
    expect(RN.StyleSheet.flatten(balance.props.style).color).toBe(p.textSecondary);
    await act(async () => control(approvalLabel()).props.onClick(event));
    expect(approvePlan).toHaveBeenCalledWith(mockApi, plan, 'A calm sunrise over the sea');
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'job' } });
});

test.each(['expired', 'shortfall'] as const)('%s keeps approval disabled', async gate => {
    if (gate === 'expired') plan = { ...plan, expiresAt: 1 };
    else mockBalance = 0;
    await render();
    await fill();
    await makePlan();
    expect(control(approvalLabel()).props.accessibilityState.disabled).toBe(true);
    await act(async () => control(approvalLabel()).props.onClick?.(event));
    expect(approvePlan).not.toHaveBeenCalled();
});

test('approving locks the form and its choices until the request settles', async () => {
    let finish!: (job: string) => void;
    jest.mocked(approvePlan).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await fill();
    await makePlan();
    await act(async () => control(approvalLabel()).props.onClick(event));
    expect(control(approvalLabel()).props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(control(t('videoAgent.briefLabel')).props.editable).toBe(false);
    expect(control(t('videoAgent.narration')).props.editable).toBe(false);
    expect(control('9:16').props.accessibilityState.selected).toBe(true);
    await act(async () => finish('job'));
    expect(approvePlan).toHaveBeenCalledTimes(1);
});
