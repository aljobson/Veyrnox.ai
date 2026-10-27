import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Developers from '../src/app/(app)/developers';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, router: { push: (...args: any[]) => mockPush(...args) } }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const textOf = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : textOf(c)).join('');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; setLocaleFromDevice(['en']); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('renders headers, literal OAuth slots, all endpoints and selectable addresses without opening a URL', async () => {
    const open = jest.spyOn(RN.Linking, 'openURL'); const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await act(async () => root.render(<Developers />)); const text = textOf(root.container);
    for (const key of ['developers.title','developers.cli.title','developers.api.title','developers.oauth.title','developers.safety.title'])
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && textOf(n) === t(key)).length).toBeGreaterThan(0);
    for (const path of ['/models','/estimates','/generations','/generations/{id}','/generations/{id}/asset','/balance']) expect(text).toContain(path);
    expect(text).toContain('token_endpoint_auth_method: none'); expect(text).toContain('Authorization: Bearer …'); expect(text).toContain('confirmed_credits'); expect(text).not.toContain('{code}');
    expect(root.container.queryAll(n => n.props.selectable && textOf(n) === 'https://veyrnox.ai/api/developer/openapi')).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && textOf(n) === t('developers.cli.kicker'))).toHaveLength(0);
    const values = [
        'pipx install "git+https://github.com/aljobson/Veyrnox.ai.git#subdirectory=agent-harness"', 'veyrnox auth login',
        'veyrnox models list', 'veyrnox generations create --model nano-banana-kie --prompt "A blue fox"',
        'https://veyrnox.ai/api/v1/developer', 'https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer',
    ];
    for (const value of values) {
        const buttons = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('developers.shareValue', { value }));
        expect(buttons).toHaveLength(1); expect(textOf(buttons[0])).toBe(t('developers.share'));
        await act(async () => buttons[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(share).toHaveBeenLastCalledWith({ message: value });
    }
    expect(share).toHaveBeenCalledTimes(6); expect(open).not.toHaveBeenCalled();
    const models = root.container.queryAll(n => n.props.accessibilityLabel === t('developers.models') && n.props.accessibilityRole === 'button')[0];
    await act(async () => models.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); expect(mockPush).toHaveBeenCalledWith('/models');
});
