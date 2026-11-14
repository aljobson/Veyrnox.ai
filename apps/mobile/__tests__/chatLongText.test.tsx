// ADR-0067 amendment 17: long messages show their count and the model's extra next to Send; the price adds the extra.
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ChatComposerDeck } from '../src/components/chat/ChatComposerDeck';
import { replyPrice, type ChatModel } from '../src/lib/chat';
import { isLongText, longTextState, messageLimit } from '../src/lib/chatLongText';
import { plural, t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.Image];
let root: Root;
const offered: ChatModel = { id: 'm', name: 'Model', maker_label: 'Maker', credits_per_reply: 1, gated: false, max_message_chars: 30000, options: { long_text: { extra_credits: 2 } } };
const plain: ChatModel = { ...offered, max_message_chars: 8000, options: { long_text: null } };
const props = { options: { thinking: false, web: false }, price: 1, canSend: true,
    sending: false, stopping: false, images: [], imageExtra: null, maxImages: 4, placeholder: 'Ask',
    onDraft: jest.fn(), onModel: jest.fn(), onOptions: jest.fn(), onLibrary: jest.fn(), onPhotos: jest.fn(),
    onRemoveImage: jest.fn(), onMake: jest.fn(), onSend: jest.fn(), onStop: jest.fn() };
const texts = () => root.container.queryAll(n => n.type === 'Text').map(n => [n.props.children].flat().join(''));

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('a message is long over 8,000 characters or 2,000 estimated tokens, and the limit follows the model', () => {
    expect([isLongText('x'.repeat(8000)), isLongText('x'.repeat(8001)), isLongText('日'.repeat(2001))]).toEqual([false, true, true]);
    expect([messageLimit(offered), messageLimit(plain), messageLimit({})]).toEqual([30000, 8000, 8000]);
    expect(longTextState(offered, 'x'.repeat(30000)).tooLong).toBe(false);
    expect(longTextState(offered, 'x'.repeat(30001)).tooLong).toBe(true);
    expect(longTextState(plain, 'x'.repeat(8001)).tooLong).toBe(true);
});

test('the price before Send adds the catalog extra only for a long message', () => {
    expect(replyPrice(offered, props.options, 0, 'x'.repeat(8000))).toBe(1);
    expect(replyPrice(offered, props.options, 0, 'x'.repeat(8001))).toBe(3);
    expect(replyPrice(plain, props.options, 0, 'x'.repeat(8001))).toBe(1);
});

test('the counter is hidden for a short message and shows n/30000 with the extra once it is long', async () => {
    await act(async () => root.render(<ChatComposerDeck {...props} model={offered} draft="hello" />));
    expect(texts().some(s => s.includes('/30000'))).toBe(false);
    await act(async () => root.render(<ChatComposerDeck {...props} model={offered} draft={'x'.repeat(9000)} price={3} />));
    const line = texts().find(s => s.startsWith('9000/30000'));
    expect(line).toContain(t('chat.composer.longMessage', { price: plural('chat.sendPriceShort', 2) }));
});

test('over the model limit the counter says so', async () => {
    await act(async () => root.render(<ChatComposerDeck {...props} model={plain} draft={'x'.repeat(8001)} canSend={false} />));
    const line = texts().find(s => s.startsWith('8001/8000'));
    expect(line).toContain(t('chat.composer.tooLong'));
});
