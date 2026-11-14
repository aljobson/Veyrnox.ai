import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ChatComposerDeck, COMPOSER_FONT_SIZE, COMPOSER_LINE_HEIGHT, COMPOSER_MIN_HEIGHT, composerMaxHeight } from '../src/components/chat/ChatComposerDeck';
import type { ChatModel } from '../src/lib/chat';
import { plural, t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image];
let root: Root;
const model: ChatModel = { id: 'm', name: 'Model', maker_label: 'Maker', credits_per_reply: 1, gated: false, options: {} };
const props = { model, options: { thinking: false, web: false }, draft: '', price: 1, canSend: true,
    sending: false, stopping: false, images: [], imageExtra: null, maxImages: 4, placeholder: 'Ask',
    onDraft: jest.fn(), onModel: jest.fn(), onOptions: jest.fn(), onLibrary: jest.fn(), onPhotos: jest.fn(),
    onRemoveImage: jest.fn(), onMake: jest.fn(), onSend: jest.fn(), onStop: jest.fn() };
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const flat = (style: unknown) => RN.StyleSheet.flatten(style as RN.StyleProp<RN.TextStyle>);
// Walks up from a node to the nearest host View, collecting its ancestors.
const ancestors = (node: { parent: unknown }) => {
    const out: { type: unknown; props: Record<string, unknown> }[] = [];
    let cur = node.parent as { parent: unknown; type: unknown; props: Record<string, unknown> } | null;
    while (cur) { out.push(cur); cur = cur.parent as typeof cur; }
    return out;
};

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('the message box shows four 17 pt lines and grows to 40% of the screen, 25% with the keyboard up', () => {
    expect(COMPOSER_FONT_SIZE).toBe(17);
    expect(COMPOSER_MIN_HEIGHT).toBeGreaterThanOrEqual(4 * COMPOSER_LINE_HEIGHT);
    expect(composerMaxHeight(874, false)).toBe(350);
    expect(composerMaxHeight(874, true)).toBe(219);
    // A very short window never caps the box below its four-line minimum.
    expect(composerMaxHeight(200, true)).toBe(COMPOSER_MIN_HEIGHT);
});

test('the rendered box is multiline, top-aligned and scrolls inside past its cap', async () => {
    await act(async () => root.render(<ChatComposerDeck {...props} />));
    const input = control(t('chat.composer.message'));
    expect(input.props).toMatchObject({ multiline: true, scrollEnabled: true, textAlignVertical: 'top', maxLength: 30000 });
    const style = flat(input.props.style);
    expect(style).toMatchObject({ fontSize: 17, lineHeight: COMPOSER_LINE_HEIGHT, minHeight: COMPOSER_MIN_HEIGHT });
    expect(style?.maxHeight).toBe(composerMaxHeight(RN.Dimensions.get('window').height, false));
});

test('Send, its price and the plus button share a row under the box, not the box row', async () => {
    await act(async () => root.render(<ChatComposerDeck {...props} />));
    const input = control(t('chat.composer.message'));
    const send = control(plural('chat.sendPrice', 1));
    const plus = control(t('chat.make.title'));
    const price = root.container.queryAll(n => n.type === 'Text' && n.props.children === plural('chat.sendPriceShort', 1))[0];
    expect(price).toBeDefined();
    const sendRow = ancestors(send).find(n => flat(n.props.style as never)?.flexDirection === 'row' && ancestors(plus).includes(n));
    expect(sendRow).toBeDefined();
    expect(ancestors(price)).toContain(sendRow);
    expect(ancestors(input)).not.toContain(sendRow);
});
