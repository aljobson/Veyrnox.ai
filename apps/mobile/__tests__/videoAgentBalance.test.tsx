import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Agent from '../src/app/(app)/create/agent';
import { requestPlan, approvePlan, videoAgentBalanceState } from '../src/lib/montage';
import { publishBalance } from '../src/lib/balanceEvents';
import { t } from '../src/lib/i18n';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const mockReplace = jest.fn();
const mockGetBalance = jest.fn();
const mockApi = { getBalance: mockGetBalance };
let mockOwner = 'owner';
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => ({ replace: mockReplace }), useFocusEffect: (fn: any) => require('react').useEffect(fn, []) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: () => () => {}, appCache: { swr: jest.fn().mockRejectedValue(Error('offline')) } }));
jest.mock('../src/lib/montage', () => ({ ...jest.requireActual('../src/lib/montage'), requestPlan: jest.fn(), approvePlan: jest.fn() }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const click = async (label: string) => act(async () => control(label).props.onClick(event));
const approveLabel = () => t('videoAgent.approve', { credits: '20' });
const hasText = (value: string) => root.container.queryAll(n => n.children.includes(value)).length > 0;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockOwner = 'owner';
    mockGetBalance.mockReset(); mockReplace.mockClear(); jest.mocked(approvePlan).mockClear();
    jest.mocked(requestPlan).mockResolvedValue({ planId: 'p', idempotencyKey: 'k', credits: 20, seconds: 10, summary: 'A quiet sea', aspect: '9:16', narrationText: '', expiresAt: Math.floor(Date.now()/1000)+1800 });
});
afterEach(async () => { await act(async () => root.unmount()); });
async function plan() {
    await act(async () => root.render(<Agent />));
    await act(async () => control(t('videoAgent.briefLabel')).props.onChangeText('A quiet sea at dawn'));
    await click(`${t('videoAgent.plan')}, free`);
}
test('balance helper matches the web, including nonfinite and invalid costs', () => {
    const script = `import { videoAgentBalanceState as state } from './app/veyrnox/_lib/authenticatedMedia.js'; console.log(JSON.stringify([null,-1,NaN,0,19,20,100].map(v => state(v,20)).concat([NaN,-1].map(c => state(100,c)))));`;
    const run = spawnSync(process.execPath,['--input-type=module','-e',script],{ cwd: resolve(__dirname,'../../..'),encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'} });
    expect(run.status).toBe(0);
    expect([null,-1,NaN,0,19,20,100].map(v => videoAgentBalanceState(v,20)).concat([NaN,-1].map(c => videoAgentBalanceState(100,c)))).toEqual(JSON.parse(run.stdout));
});
test('real useBalance follows retries, purchases and later lower balances', async () => {
    await plan(); expect(control(approveLabel()).props.accessibilityState.disabled).toBe(true);
    expect(control(t('videoAgentBalance.retry'))).toBeDefined();
    await click(approveLabel()); expect(approvePlan).not.toHaveBeenCalled();
    mockGetBalance.mockResolvedValue({ balance: 0 }); await click(t('videoAgentBalance.retry'));
    expect(hasText(t('videoAgent.buy'))).toBe(true);
    await act(async () => publishBalance('owner',100)); expect(control(approveLabel()).props.accessibilityState.disabled).toBe(false);
    await act(async () => publishBalance('owner',5)); expect(control(approveLabel()).props.accessibilityState.disabled).toBe(true);
    await act(async () => publishBalance('someone-else',100)); expect(control(approveLabel()).props.accessibilityState.disabled).toBe(true);
});
test('failed retry keeps unavailable status and checking disables Retry', async () => {
    await plan(); let reject!: (e: Error) => void;
    mockGetBalance.mockImplementation(() => new Promise((_, no) => { reject = no; }));
    await click(t('videoAgentBalance.retry'));
    expect(hasText(t('videoAgentBalance.checking'))).toBe(true);
    expect(control(t('videoAgentBalance.retry')).props.accessibilityState.disabled).toBe(true);
    await act(async () => reject(Error('offline')));
    expect(hasText(t('videoAgentBalance.unavailable'))).toBe(true);
    expect(control(approveLabel()).props.accessibilityState.disabled).toBe(true);
});
test('a retry started for a previous owner cannot publish into the current account', async () => {
    await plan(); let resolve!: (v: {balance: number}) => void;
    mockGetBalance.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    await click(t('videoAgentBalance.retry')); mockOwner = 'new-owner';
    await act(async () => resolve({ balance: 100 }));
    expect(control(approveLabel()).props.accessibilityState.disabled).toBe(true);
});
