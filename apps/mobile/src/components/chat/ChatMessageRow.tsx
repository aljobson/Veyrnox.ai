import { memo, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../../lib/chat';
import type { CatalogModel } from '../../lib/media';
import { parseStudioDrafts } from '../../lib/studioSkills';
import { MessageBubble } from './MessageBubble';

// Keep draft parsing and the bound star callback local to each message.
export const ChatMessageRow = memo(function ChatMessageRow({ message, sending, catalog, selected, onStar }: {
    message: ChatMessage; sending: boolean; catalog: CatalogModel[] | null; selected: boolean; onStar(id: string): Promise<void>;
}) {
    const drafts = useMemo(() => message.role === 'assistant' && catalog ? parseStudioDrafts(message.content, catalog) : [], [message.role, message.content, catalog]);
    const star = useCallback(() => { void onStar(message.id); }, [onStar, message.id]);
    return <MessageBubble message={message} sending={sending} drafts={drafts} selected={selected} onStar={star} />;
});
