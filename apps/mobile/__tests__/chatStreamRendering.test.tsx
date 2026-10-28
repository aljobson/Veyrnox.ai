import { act, useState } from 'react';
import { View, Text, AccessibilityInfo } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ChatMessageRow } from '../src/components/chat/ChatMessageRow';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import { useChatDeltas } from '../src/lib/useChatDeltas';
import { createChatDeltaBuffer } from '../src/lib/chatDeltaBuffer';
import type { ChatMessage } from '../src/lib/chat';
void [View, Text];
const mockRender = jest.fn();
jest.mock('../src/components/chat/ChatText', () => ({
    replyActions: () => [],
    ChatText: ({ content }: { content: string }) => { mockRender(content); return require('react').createElement(require('react-native').Text, null, content); },
}));
jest.mock('../src/components/chat/DraftCards', () => ({ DraftCards: () => null }));
const earlier: ChatMessage = { id: 'earlier', role: 'assistant', content: 'Earlier answer' };
const star = jest.fn().mockResolvedValue(undefined);
let stream: ReturnType<typeof useChatDeltas>;
let root: Root;
function ConversationHarness() {
    const [messages, setMessages] = useState<ChatMessage[] | null>([earlier, { id: 'live', role: 'assistant', content: '' }]);
    stream = useChatDeltas(setMessages);
    return <>{messages!.map(message => <ChatMessageRow key={message.id} message={message} catalog={null} selected={false} onStar={star} sending={message.id === 'live'} />)}</>;
}
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test('earlier bubbles do not re-render during streaming and the last batch is complete immediately on flush', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await act(async () => root.render(<ConversationHarness />));
    stream.begin('live');
    for (const text of ['Hello', ', ', 'world']) await act(async () => stream.add(text));
    expect(mockRender.mock.calls.map(([text]) => text)).toEqual(['Earlier answer', '…']);
    await act(async () => jest.advanceTimersByTime(50));
    expect(mockRender).toHaveBeenLastCalledWith('Hello, world');
    await act(async () => { stream.add('!'); stream.flush(); });
    expect(mockRender).toHaveBeenLastCalledWith('Hello, world!');
    expect(mockRender.mock.calls.filter(([text]) => text === 'Earlier answer')).toHaveLength(1);
    expect(mockRender).toHaveBeenCalledTimes(4);
    expect(announce).not.toHaveBeenCalled();
    announce.mockRestore();
});

test('MessageBubble itself skips unchanged props', async () => {
    const props = { message: earlier, sending: false, drafts: [] };
    await act(async () => root.render(<MessageBubble {...props} />));
    await act(async () => root.render(<MessageBubble {...props} />));
    expect(mockRender).toHaveBeenCalledTimes(1);
});

test.each(['done', 'error', 'unmount'])('%s flushes pending deltas once and cancels the timer', reason => {
    const append = jest.fn(); const buffer = createChatDeltaBuffer(append);
    buffer.begin('a'); buffer.add('one'); buffer.add(' two');
    if (reason === 'unmount') buffer.close(); else buffer.flush();
    expect(append).toHaveBeenCalledWith('a', 'one two');
    jest.advanceTimersByTime(100);
    expect(append).toHaveBeenCalledTimes(1);
    if (reason === 'unmount') { buffer.add('late'); jest.advanceTimersByTime(100); expect(append).toHaveBeenCalledTimes(1); }
});

test('the hook cleanup flushes pending text and removes its timer', async () => {
    await act(async () => root.render(<ConversationHarness />));
    const schedule = jest.spyOn(globalThis, 'setTimeout');
    const cancel = jest.spyOn(globalThis, 'clearTimeout');
    stream.begin('live'); stream.add('last word');
    const timer = schedule.mock.results.at(-1)!.value;
    const close = jest.spyOn(stream, 'close');
    await act(async () => root.unmount());
    expect(close).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(timer);
    schedule.mockRestore(); cancel.mockRestore();
});

test('close keeps the streaming id (so "writing" stays) and ignores late deltas', () => {
    const append = jest.fn();
    const { createChatDeltaBuffer } = require('../src/lib/chatDeltaBuffer');
    const buffer = createChatDeltaBuffer(append);
    buffer.begin('m1');
    buffer.add('a');
    buffer.close();
    expect(append).toHaveBeenCalledWith('m1', 'a');
    expect(buffer.messageId).toBe('m1');
    buffer.add('late');
    buffer.flush();
    expect(append).toHaveBeenCalledTimes(1);
    buffer.begin('m2');
    buffer.add('b');
    buffer.flush();
    expect(append).toHaveBeenLastCalledWith('m2', 'b');
});
