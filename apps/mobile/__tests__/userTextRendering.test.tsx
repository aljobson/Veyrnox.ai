import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Folders from '../src/app/(app)/chat/folders';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { ChatText } from '../src/components/chat/ChatText';
import { fetchFolders } from '../src/lib/chatLibrary';
import { t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/lib/chatLibrary', () => ({ ...jest.requireActual('../src/lib/chatLibrary'), fetchFolders: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable, RN.TextInput, RN.FlatList, RN.ScrollView];

// Strings that would be markup, a link or a reordered line if anything interpreted them.
const HOSTILE = [
    '<script>alert(1)</script>',
    `evil${String.fromCharCode(0x202e)}gnp.exe`,
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    'https://example.com/?a=1&b=2',
    'veyrnox://auth/callback?code=1',
    '**bold** `code` {{title}} {value1}',
];

let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
const textNodes = (value: string) => root.container.queryAll(n => n.children.includes(value));
const interactive = () => root.container.queryAll(n => n.props.accessibilityRole === 'link' || (typeof n.props.onClick === 'function' && n.props.accessibilityRole !== 'button'));

test.each(HOSTILE)('a folder named %j is one plain text node, never a link or markup', async name => {
    jest.mocked(fetchFolders).mockResolvedValue([{ id: '1', name, count: 2 }]);
    await act(async () => root.render(<Folders />));
    expect(textNodes(name)).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'link')).toHaveLength(0);
    // The name is passed through the label templates as data, so its braces are not expanded a second time.
    const rename = root.container.queryAll(n => n.props.accessibilityLabel === t('chat.rename4', { value1: name }))[0];
    expect(rename).toBeDefined();
});

test.each(HOSTILE)('a message you typed, %j, is shown as plain text, never a link or markup', async content => {
    await act(async () => root.render(<MessageBubble message={{ id: 'm', role: 'user', content } as any} sending={false} drafts={[]} />));
    expect(textNodes(content)).toHaveLength(1);
    expect(interactive()).toHaveLength(0);
});

test('an assistant reply with a javascript: link shows the characters and offers no link', async () => {
    await act(async () => root.render(<ChatText content="[click](javascript:alert(1)) and <script>x</script>" />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'link')).toHaveLength(0);
    const shown = root.container.queryAll(n => typeof n.children[0] === 'string').map(n => n.children.join('')).join('');
    expect(shown).toContain('[click](javascript:alert(1))');
    expect(shown).toContain('<script>x</script>');
});

test('an assistant reply with a normal https link offers exactly one link, with its own address', async () => {
    await act(async () => root.render(<ChatText content="see [docs](https://example.com/a)" />));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'link')).toHaveLength(1);
});
