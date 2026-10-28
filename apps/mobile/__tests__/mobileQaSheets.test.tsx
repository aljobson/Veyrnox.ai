import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { AiConsentHost } from '../src/components/AiConsentHost';
import { LegalSheet, LegalSheetContent } from '../src/components/legal/LegalSheet';
import { ChatSettings } from '../src/components/chat/ChatSettings';
import { ModelPicker } from '../src/components/chat/ModelPicker';
import { PickSheet } from '../src/components/oddlings/PickSheet';

let mockAsk: (() => Promise<boolean>) | null;
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { setPrompter: (fn: typeof mockAsk) => { mockAsk = fn; } } }));
jest.mock('expo-secure-store', () => ({ getItem: () => null }));
jest.mock('react-native', () => ({ Modal: 'Modal', View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Text: 'Text', FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' }, NativeModules: {}, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/components/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../src/components/legal/LegalDocumentView', () => ({ LegalDocumentView: () => null }));
jest.mock('../src/components/ui', () => {
    const React = jest.requireActual('react');
    return Object.fromEntries([
        ...['Text', 'TextField', 'Button', 'Card', 'Icon'].map(name => [name, (props: any) => React.createElement(name, props)]),
        ['themedStyles', (fn: any) => fn], ['useThemedStyles', (fn: any) => fn({})],
    ]);
});
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
const nativeEscapes = (node: TestInstance) => node.queryAll(n => (n.type === 'View' || n.type === 'ScrollView') && typeof n.props.onAccessibilityEscape === 'function');
const press = async (label: string) => {
    const button = root.container.queryAll(n => n.type === 'Button' && n.props.label === label)[0];
    expect(button).toBeDefined();
    await act(async () => button.props.onPress());
};
function modalEscape() {
    const modal = root.container.queryAll(n => n.type === 'Modal')[0];
    expect(modal.props.onAccessibilityEscape).toBeUndefined();
    const handlers = nativeEscapes(modal);
    expect(handlers).toHaveLength(1);
    return handlers[0].props.onAccessibilityEscape;
}

test('AI consent escape declines just like Not now, but leaving privacy does not resolve consent', async () => {
    await act(async () => root.render(<AiConsentHost />));
    let result!: Promise<boolean>;
    await act(async () => { result = mockAsk!(); });
    const answered = jest.fn(); result.then(answered);
    await press('Read the Privacy Policy');
    await act(async () => modalEscape()());
    expect(answered).not.toHaveBeenCalled();
    await press('Read the Privacy Policy');
    await press('Close');
    expect(answered).not.toHaveBeenCalled();
    await act(async () => modalEscape()());
    await expect(result).resolves.toBe(false);
    await act(async () => { result = mockAsk!(); });
    await press('Not now');
    await expect(result).resolves.toBe(false);
});

test('LegalSheet puts escape on native content and uses the Close callback', async () => {
    const close = jest.fn();
    await act(async () => root.render(<LegalSheet doc="privacy" onClose={close} />));
    await act(async () => modalEscape()());
    expect(close).toHaveBeenCalledTimes(1);
    await press('Close'); expect(close).toHaveBeenCalledTimes(2);
});

test('reusable legal sheet content also closes when mounted without a Modal', async () => {
    const close = jest.fn();
    await act(async () => root.render(<LegalSheetContent doc="privacy" onClose={close} />));
    expect(root.container.queryAll(n => n.type === 'Modal')).toHaveLength(0);
    await act(async () => nativeEscapes(root.container)[0].props.onAccessibilityEscape());
    await press('Close'); expect(close).toHaveBeenCalledTimes(2);
});

test('ChatSettings escape closes without saving unsaved settings', async () => {
    const close = jest.fn(), save = jest.fn();
    await act(async () => root.render(<ChatSettings visible thread={{ model_id: 'model', system_prompt: '' }} models={[]} onSave={save} onClose={close} />));
    const field = root.container.queryAll(n => n.type === 'TextField')[0];
    await act(async () => field.props.onChangeText('unsaved'));
    await act(async () => modalEscape()());
    expect(save).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
    await press('Close'); expect(close).toHaveBeenCalledTimes(2);
});

test('model and option picker escape closes without choosing an item', async () => {
    const close = jest.fn(), pick = jest.fn();
    await act(async () => root.render(<ModelPicker visible currentId="model" models={[]} onPick={pick} onClose={close} />));
    await act(async () => modalEscape()());
    await press('Close model list');
    expect(close).toHaveBeenCalledTimes(2); expect(pick).not.toHaveBeenCalled();
    await act(async () => root.render(<PickSheet title="Options" choices={[]} value="" onPick={pick} onClose={close} />));
    await act(async () => modalEscape()());
    expect(close).toHaveBeenCalledTimes(3); expect(pick).not.toHaveBeenCalled();
});
