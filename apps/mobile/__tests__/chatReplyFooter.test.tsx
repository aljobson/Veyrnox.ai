import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { MessageBubble } from '../src/components/chat/MessageBubble';
import type { ChatMessage } from '../src/lib/chat';
import { t, plural } from '../src/lib/i18n';
import { tokensForScheme, DEFAULT_APPEARANCE } from '../src/theme';
const id = '12345678-1234-1234-1234-123456789abc';
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });
test.each<[ChatMessage['status'], number, string]>([['error', 0, 'Cut off. No credits used'], ['canceled', 3, 'Stopped. 3 credits'], ['canceled', 0, 'Stopped. Free'], ['complete', 0, 'Free'], ['complete', 2, '2 credits']])('%s with %i shows server price exactly once', async (status, credits, label) => {
    await act(async () => root.render(<MessageBubble message={{ id, role: 'assistant', content: 'Hi', status, credits }} sending={false} drafts={[]} />));
    expect(root.container.queryAll(n => n.children.includes(label))).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('chatDepth.copyLabel'))).toHaveLength(1);
});
test('legacy cost keeps warning style and optimistic rows have no controls', async () => {
    await act(async () => root.render(<MessageBubble message={{ id: 'a', role: 'assistant', content: 'Hello', credits: 2 }} sending={false} drafts={[]} />));
    const costs = root.container.queryAll(n => n.children.includes(plural('chat.replyCost', 2)));
    expect(costs).toHaveLength(1); expect(RN.StyleSheet.flatten(costs[0].props.style)).toMatchObject({ color: tokensForScheme('light', DEFAULT_APPEARANCE).warning, fontVariant: ['tabular-nums'] });
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('chatDepth.copyLabel'))).toHaveLength(0);
    await act(async () => root.render(<MessageBubble message={{ id: 'a123', status: 'complete', role: 'assistant', content: 'Hi' }} sending drafts={[]} />));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('chatDepth.starLabel'))).toHaveLength(0);
});
test('copy strips studio blocks and star announces selection outside the group', async () => {
    const share = jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: RN.Share.sharedAction, activityType: undefined }), star = jest.fn();
    const message: ChatMessage = { id, role: 'assistant', status: 'complete', credits: 0, content: 'Words\n```studio\n{"model":"m","prompt":"x"}\n```' };
    await act(async () => root.render(<MessageBubble message={message} sending={false} drafts={[]} onStar={star} />));
    const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
    await act(async () => control(t('chatDepth.copyLabel')).props.onClick({ nativeEvent: {} })); expect(share).toHaveBeenCalledWith({ message: 'Words' });
    const button = control(t('chatDepth.starLabel')); expect(button.props.accessibilityState.selected).toBe(false);
    await act(async () => button.props.onClick({ nativeEvent: {} })); expect(star).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<MessageBubble message={message} sending={false} drafts={[]} onStar={star} selected />));
    expect(control(t('chatDepth.unstarLabel')).props.accessibilityState.selected).toBe(true); share.mockRestore();
});
