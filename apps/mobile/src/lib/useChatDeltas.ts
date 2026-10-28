import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage } from './chat';
import { createChatDeltaBuffer } from './chatDeltaBuffer';

export function useChatDeltas(setMessages: Dispatch<SetStateAction<ChatMessage[] | null>>) {
    const deltas = useMemo(() => createChatDeltaBuffer((id, text) => {
        setMessages(messages => (messages ?? []).map(message => message.id === id ? { ...message, content: message.content + text } : message));
    }), [setMessages]);
    useEffect(() => () => deltas.close(), [deltas]);
    return deltas;
}
