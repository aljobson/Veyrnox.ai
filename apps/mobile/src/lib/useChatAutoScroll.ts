import { useEffect, useRef } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// How close to the bottom still counts as "reading the newest message", in points.
const AT_END_SLOP = 48;
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;
const isAtEnd = ({ nativeEvent: { contentOffset, layoutMeasurement, contentSize } }: ScrollEvent) =>
    contentOffset.y + layoutMeasurement.height >= contentSize.height - AT_END_SLOP;

// Keeps the newest message in view: on a new message, when a reply starts or streams, and when the
// list gets shorter (the keyboard opens, the composer grows). A person who drags up is left alone
// until they scroll back to the bottom or send again.
export function useChatAutoScroll(count: number, sending: boolean, keyboardOpen = false) {
    const messageList = useRef<FlatList>(null);
    const followReply = useRef(false);
    const atEnd = useRef(true);
    const previous = useRef({ count: 0, sending: false, keyboardOpen: false });
    useEffect(() => {
        const before = previous.current;
        if (count > before.count || (sending && !before.sending)) {
            followReply.current = true;
            messageList.current?.scrollToEnd({ animated: true });
        } else if (keyboardOpen && !before.keyboardOpen && (followReply.current || atEnd.current)) {
            messageList.current?.scrollToEnd({ animated: true });
        }
        previous.current = { count, sending, keyboardOpen };
    }, [count, sending, keyboardOpen]);
    const settle = (event: ScrollEvent) => {
        atEnd.current = isAtEnd(event);
        if (atEnd.current) followReply.current = true;
    };
    return {
        messageList,
        onContentSizeChange: () => {
            if (followReply.current) messageList.current?.scrollToEnd({ animated: true });
        },
        onLayout: () => {
            if (followReply.current || atEnd.current) messageList.current?.scrollToEnd({ animated: false });
        },
        onScroll: (event: ScrollEvent) => { atEnd.current = isAtEnd(event); },
        onScrollBeginDrag: () => { followReply.current = false; },
        onScrollEndDrag: settle,
        onMomentumScrollEnd: settle,
    };
}
