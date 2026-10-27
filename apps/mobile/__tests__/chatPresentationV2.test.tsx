import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { Chip, Text } from '../src/components/ui';
import { AppearanceContext } from '../src/components/ui/AppearanceContext';
import { ChatComposerDeck } from '../src/components/chat/ChatComposerDeck';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { AttachStrip } from '../src/components/chat/AttachStrip';
import { DEFAULT_APPEARANCE, tokensForScheme, type ThemePreference } from '../src/theme';
import type { ChatModel } from '../src/lib/chat';
import { MENU_ICONS } from '../src/lib/menuIcons';
import { plural, t } from '../src/lib/i18n';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image, RN.ActivityIndicator];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const model: ChatModel = { id: 'm', name: 'Model', maker_label: 'Maker', credits_per_reply: 2, gated: false,
    options: { thinking: { extra_credits: 3 }, web: { extra_credits: 1 } } };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockPush.mockClear();
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('rich chips retain spoken text, native states, disabled gates and decorative icons', async () => {
    const press = jest.fn();
    const render = (disabled: boolean) => root.render(<Chip label="Model" icon="cpu" trailingIcon="caretDown" selected
        accessibilityRole="switch" accessibilityLabel="Choose model" accessibilityState={{ checked: true, disabled }}
        disabled={disabled} testID="model" onPress={press}><Text>Model</Text><Text tone="warning">2 credits</Text></Chip>);
    await act(async () => render(true));
    expect(control('Choose model').props).toMatchObject({ testID: 'model', accessibilityRole: 'switch', accessibilityState: { checked: true, disabled: true } });
    expect(control('Choose model').props.accessibilityState.selected).toBeUndefined();
    for (const icon of ['cpu', 'caretDown'] as const) {
        const image = root.container.queryAll(n => n.props.source === MENU_ICONS[icon])[0];
        expect(image.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no' });
    }
    await act(async () => control('Choose model').props.onClick?.(event));
    expect(press).not.toHaveBeenCalled();
    await act(async () => render(false));
    await act(async () => control('Choose model').props.onClick(event));
    expect(press).toHaveBeenCalledTimes(1);
});

test('the deck retains modes, option prices, multiline constraints and send/stop gates', async () => {
    const onMake = jest.fn(), onOptions = jest.fn(), onSend = jest.fn(), onStop = jest.fn();
    const props = { model, options: { thinking: false, web: false }, draft: 'Hello', price: 2, canSend: true,
        sending: false, stopping: false, images: [], imageExtra: null, maxImages: 4, placeholder: 'Ask',
        onDraft: jest.fn(), onModel: jest.fn(), onOptions, onLibrary: jest.fn(), onPhotos: jest.fn(),
        onRemoveImage: jest.fn(), onMake, onSend, onStop };
    await act(async () => root.render(<ChatComposerDeck {...props} />));
    expect(control(t('chat.composer.message')).props).toMatchObject({ multiline: true, maxLength: 8000, value: 'Hello' });
    for (const kind of ['image', 'video', 'audio'] as const) {
        await act(async () => control(t(`chat.make.kind.${kind}`)).props.onClick(event));
        expect(onMake).toHaveBeenLastCalledWith(kind);
    }
    expect(control(t('chat.composer.chat')).props.accessibilityState.selected).toBe(true);
    for (const icon of ['chat', 'image', 'video', 'audio', 'cpu', 'caretDown', 'brain', 'globe'] as const) {
        expect(root.container.queryAll(n => n.props.source === MENU_ICONS[icon]).length).toBeGreaterThan(0);
    }
    const thinking = `${t('chat.opt.thinking')}, ${plural('chat.opt.extraSpoken', 3)}`;
    const web = `${t('chat.opt.web')}, ${plural('chat.opt.extraSpoken', 1)}`;
    await act(async () => control(thinking).props.onClick(event));
    expect(onOptions).toHaveBeenLastCalledWith({ thinking: true, web: false });
    await act(async () => control(web).props.onClick(event));
    expect(onOptions).toHaveBeenLastCalledWith({ thinking: false, web: true });
    expect(control(web).props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    await act(async () => control(plural('chat.sendPrice', 2)).props.onClick(event));
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<ChatComposerDeck {...props} canSend={false} />));
    await act(async () => control(plural('chat.sendPrice', 2)).props.onClick?.(event));
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<ChatComposerDeck {...props} sending />));
    expect(control(thinking).props.accessibilityState.disabled).toBe(true);
    expect(control(plural('chat.sendPrice', 2))).toBeUndefined();
    await act(async () => control(t('chat.stopLabel')).props.onClick(event));
    expect(onStop).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<ChatComposerDeck {...props} sending stopping />));
    await act(async () => control(t('chat.stopping')).props.onClick?.(event));
    expect(onStop).toHaveBeenCalledTimes(1);
});

test.each<ThemePreference>(['light', 'dark', 'oled'])('bubbles and credits remain legible on %s neutral surfaces', async theme => {
    const settings = { ...DEFAULT_APPEARANCE, theme };
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', settings);
    await act(async () => root.render(<AppearanceContext.Provider value={settings}>
        <MessageBubble message={{ id: 'u', role: 'user', content: 'Hi' }} sending={false} drafts={[]} />
        <MessageBubble message={{ id: 'a', role: 'assistant', content: 'Hello', credits: 2 }} sending={false} drafts={[]} />
    </AppearanceContext.Provider>));
    const user = RN.StyleSheet.flatten(control('You: Hi').props.style);
    const assistant = RN.StyleSheet.flatten(control('Assistant: Hello').props.style);
    expect(user.backgroundColor).toBe(theme === 'light' ? p.surface : p.bgElevated1);
    expect(assistant.backgroundColor).toBe(theme === 'light' ? p.bgElevated1 : p.bgElevated2);
    expect(user.backgroundColor).not.toBe(p.bg);
    expect(assistant.backgroundColor).not.toBe(p.bg);
    if (theme === 'light') expect(assistant).toMatchObject({ borderColor: p.borderSubtle, borderWidth: RN.StyleSheet.hairlineWidth });
    const cost = root.container.queryAll(n => n.children.includes(plural('chat.replyCost', 2)))[0];
    expect(RN.StyleSheet.flatten(cost.props.style)).toMatchObject({ color: p.warning, fontVariant: ['tabular-nums'] });
    await act(async () => root.render(<MessageBubble message={{ id: 'a', role: 'assistant', content: '' }} sending drafts={[]} />));
    expect(control('Assistant: writing')).toBeDefined();
});

test('attachment targets keep limits, remove labels and callbacks', async () => {
    const library = jest.fn(), photos = jest.fn(), remove = jest.fn();
    await act(async () => root.render(<AttachStrip items={[{ id: 'one', assetId: 'one', preview: 'https://example.test/image' }]}
        extra={2} max={1} onLibrary={library} onPhotos={photos} onRemove={remove} />));
    for (const label of [t('chat.attach.libraryLabel'), t('chat.attach.photosLabel')]) {
        expect(control(label).props.accessibilityState.disabled).toBe(true);
        await act(async () => control(label).props.onClick?.(event));
    }
    expect(library).not.toHaveBeenCalled();
    expect(photos).not.toHaveBeenCalled();
    await act(async () => control(t('chat.attach.removeN', { n: '1' })).props.onClick(event));
    expect(remove).toHaveBeenCalledWith('one');
});
