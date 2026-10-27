import { act, type ReactElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import { AppearanceContext, Button } from '../src/components/ui';
import { ChatLibraryScreen } from '../src/components/chat/ChatLibraryScreen';
import { ChatSettings } from '../src/components/chat/ChatSettings';
import { ChatComposerDeck } from '../src/components/chat/ChatComposerDeck';
import { AttachStrip } from '../src/components/chat/AttachStrip';
import { ConversationEmpty } from '../src/components/chat/ConversationEmpty';
import { ModelPicker } from '../src/components/chat/ModelPicker';
import { MakePanel } from '../src/components/chat/MakePanel';
import Folders from '../src/app/(app)/chat/folders';
import PersonaForm from '../src/app/(app)/chat/persona/[id]';
import Agent from '../src/app/(app)/create/agent';
import { DEFAULT_APPEARANCE, tokensForScheme, type ThemePreference } from '../src/theme';
import { MENU_ICONS } from '../src/lib/menuIcons';
import { plural, t } from '../src/lib/i18n';

const mockApi = {};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockPendingSave = jest.fn(() => new Promise(() => {}));
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null }, Link: ({ children }: any) => children,
    useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: 'persona' }),
    useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]),
}));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => 100 }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => ({
    listModels: async () => [], listThreads: async () => [{ id: 'thread', title: 'Example', model_id: 'm' }],
}) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'),
    fetchFolders: async () => [{ id: 'folder', name: 'Example', count: 1 }],
    fetchPersonas: async () => ({ enabled: true, personas: [{ id: 'persona', name: 'Example', instructions: 'Be brief', modelId: null, thinking: false, web: false }] }),
    createFolder: () => mockPendingSave(),
    updatePersona: () => mockPendingSave(),
}));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [] }));
jest.mock('../src/lib/montage', () => ({ ...jest.requireActual('../src/lib/montage'), requestPlan: async () => ({
    planId: 'plan', idempotencyKey: 'key', credits: 20, summary: 'A calm film', aspect: '9:16', expiresAt: Math.floor(Date.now() / 1000) + 1800,
}) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image, RN.ActivityIndicator];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1, persist: jest.fn() };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const style = (node: TestInstance) => RN.StyleSheet.flatten(node.props.style) ?? {};
const text = (node: TestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('');
function opacity(node: TestInstance): number {
    return (style(node).opacity ?? 1) * (node.parent ? opacity(node.parent) : 1);
}
function background(node: TestInstance): string {
    return style(node).backgroundColor ?? (node.parent ? background(node.parent) : 'transparent');
}
const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
async function render(element: ReactElement, theme: ThemePreference = 'light') {
    await act(async () => root.render(<AppearanceContext.Provider value={{ ...DEFAULT_APPEARANCE, theme }}>{element}</AppearanceContext.Provider>));
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
    jest.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); });

test.each<ThemePreference>(['light', 'dark', 'oled'])('row deletes and filled confirmation labels contrast on %s', async theme => {
    const p = tokensForScheme(theme === 'light' ? 'light' : 'dark', { ...DEFAULT_APPEARANCE, theme });
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    for (const [element, label] of [
        [<ChatLibraryScreen />, t('chat.delete.label', { name: 'Example' })],
        [<Folders />, 'Delete Example'],
        [<PersonaForm />, 'Delete persona'],
    ] as const) {
        await render(element, theme);
        const button = control(label);
        expect(style(button).backgroundColor).toBeUndefined();
        const ink = button.queryAll(n => n.children.some(child => typeof child === 'string'))[0];
        expect(style(ink).color).toBe(p.danger);
        expect(contrast(style(ink).color, background(button))).toBeGreaterThanOrEqual(4.5);
        // Pressed tertiary background must also remain readable.
        expect(contrast(style(ink).color, p.surface)).toBeGreaterThanOrEqual(4.5);
        await act(async () => button.props.onClick(event));
        expect(alert).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), expect.arrayContaining([expect.objectContaining({ style: 'destructive' })]));
    }
    await render(<Button variant="destructive" label="Confirm deletion" />, theme);
    const button = control('Confirm deletion');
    const ink = button.queryAll(n => n.children.includes('Confirm deletion'))[0];
    expect(contrast(style(ink).color, background(button))).toBeGreaterThanOrEqual(4.5);
    alert.mockRestore();
});

test('attachment badge is 24pt with a full inward 44pt hit area and a single disabled fade', async () => {
    const remove = jest.fn();
    const props = { items: [{ id: 'one', assetId: 'one' }], extra: 2, max: 1, onLibrary: jest.fn(), onPhotos: jest.fn(), onRemove: remove };
    await render(<AttachStrip {...props} />);
    for (const label of [t('chat.attach.libraryLabel'), t('chat.attach.photosLabel')]) expect(opacity(control(label))).toBe(0.4);
    const badge = control(t('chat.attach.removeN', { n: '1' }));
    const p = tokensForScheme('light');
    expect(style(badge)).toMatchObject({ width: 24, height: 24, minWidth: 24, minHeight: 24, borderRadius: 12, backgroundColor: p.bgElevated2, borderColor: p.borderSubtle, borderWidth: RN.StyleSheet.hairlineWidth });
    const hit = badge.props.hitSlop;
    expect(style(badge).width + hit.left + hit.right).toBe(44);
    expect(style(badge).height + hit.top + hit.bottom).toBe(44);
    expect(style(badge.parent!)).toMatchObject({ width: 44, height: 44, top: 0, right: 0, alignItems: 'flex-end', justifyContent: 'flex-start' });
    expect(badge.queryAll(n => n.props.source === MENU_ICONS.close)).toHaveLength(1);
    await act(async () => badge.props.onClick(event));
    expect(remove).toHaveBeenCalledWith('one');
    await render(<AttachStrip {...props} disabled />);
    expect(opacity(control(t('chat.attach.removeN', { n: '1' })))).toBe(0.4);
});

test('save, add and make actions have only the primitive disabled fade', async () => {
    await render(<ChatSettings visible thread={{ model_id: 'm', system_prompt: '' }} models={[]} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(opacity(control(t('chat.settings.save')))).toBe(0.4);
    await render(<MakePanel visible onClose={jest.fn()} />);
    expect(opacity(control(t('chat.make.button')))).toBe(0.4);
    await render(<Folders />);
    await act(async () => control('Folder name').props.onChangeText('New folder'));
    await act(async () => control('Add').props.onClick(event));
    expect(control('Add').props.accessibilityState.disabled).toBe(true);
    expect(opacity(control('Add'))).toBe(0.4);
    await render(<PersonaForm />);
    await act(async () => control('Save').props.onClick(event));
    expect(control('Save').props.accessibilityState.disabled).toBe(true);
    expect(opacity(control('Save'))).toBe(0.4);
});

test('send price follows the Send disabled fade and retains its warning tone', async () => {
    const props = { model: { id: 'm', name: 'Model', maker_label: 'Maker', credits_per_reply: 2, gated: false },
        options: { thinking: false, web: false }, draft: '', price: 2, sending: false, stopping: false, images: [], imageExtra: null,
        maxImages: 4, placeholder: 'Ask', onDraft: jest.fn(), onModel: jest.fn(), onOptions: jest.fn(), onLibrary: jest.fn(),
        onPhotos: jest.fn(), onRemoveImage: jest.fn(), onMake: jest.fn(), onSend: jest.fn(), onStop: jest.fn() };
    for (const canSend of [false, true]) {
        await render(<ChatComposerDeck {...props} canSend={canSend} />);
        const price = root.container.queryAll(n => n.children.includes(plural('chat.sendPriceShort', 2)))[0];
        expect(style(price)).toMatchObject({ color: tokensForScheme('light').warning, fontVariant: ['tabular-nums'] });
        expect(opacity(price)).toBe(opacity(control(plural('chat.sendPrice', 2))));
        expect(opacity(price)).toBe(canSend ? 1 : 0.4);
    }
});

test('approval shows the priced label and field spacing belongs outside the input shell', async () => {
    await render(<Agent />);
    for (const label of [t('videoAgent.briefLabel'), t('videoAgent.narration')]) {
        const input = control(label);
        expect(style(input).marginTop).toBeUndefined();
        expect(style(input.parent!).marginTop).toBeUndefined();
        expect(style(input.parent!.parent!).marginTop).toBe(8);
    }
    await act(async () => control(t('videoAgent.briefLabel')).props.onChangeText('A calm sunrise over the sea'));
    await act(async () => control(`${t('videoAgent.plan')}, free`).props.onClick(event));
    const label = t('videoAgent.approve', { credits: '20' });
    expect(text(control(label))).toBe(label);
});

test('Film arrow trails, Back arrow leads, and their accessible names contain only words', async () => {
    await render(<ConversationEmpty skillNote={null} applyStarter={jest.fn()} />);
    const film = control('Open Film Studio');
    expect(text(film)).toBe('Open Film Studio');
    const filmChildren = film.children.filter(child => typeof child !== 'string');
    expect(text(filmChildren[0])).toBe('Open Film Studio');
    expect(filmChildren[1].props.source).toBe(MENU_ICONS.arrowRight);
    await render(<ChatSettings visible thread={{ model_id: 'm', system_prompt: '' }} models={[]} onSave={jest.fn()} onClose={jest.fn()} />);
    const back = control(t('chat.settings.back'));
    expect(text(back)).toBe(t('chat.settings.back'));
    expect(back.children[0]).toMatchObject({ props: { source: MENU_ICONS.arrowLeft } });
});

test('model backdrop closes without a button fill or animation wrapper', async () => {
    const close = jest.fn();
    await render(<ModelPicker visible currentId="m" models={[]} onPick={jest.fn()} onClose={close} />);
    const backdrop = control(t('chat.model.close'));
    expect(style(backdrop)).toMatchObject({ flex: 1, backgroundColor: tokensForScheme('light').scrim });
    expect(style(backdrop).minWidth).toBeUndefined();
    expect(style(backdrop).transform).toBeUndefined();
    await act(async () => backdrop.props.onResponderGrant?.(event));
    expect(style(control(t('chat.model.close'))).backgroundColor).toBe(tokensForScheme('light').scrim);
    await act(async () => control(t('chat.model.close')).props.onResponderRelease(event));
    expect(close).toHaveBeenCalledTimes(1);
});
