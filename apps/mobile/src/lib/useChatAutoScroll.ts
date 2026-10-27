import { useEffect, useRef } from 'react';
import type { FlatList } from 'react-native';

export function useChatAutoScroll(count: number, sending: boolean) {
    const messageList = useRef<FlatList>(null);
    const followReply = useRef(false);
    const previous = useRef({ count: 0, sending: false });
    useEffect(() => {
        if (count > previous.current.count || (sending && !previous.current.sending)) {
            followReply.current = true;
            messageList.current?.scrollToEnd({ animated: true });
        }
        previous.current = { count, sending };
    }, [count, sending]);
    return {
        messageList,
        onContentSizeChange: () => {
            if (followReply.current) messageList.current?.scrollToEnd({ animated: true });
        },
        onScrollBeginDrag: () => { followReply.current = false; },
    };
}
