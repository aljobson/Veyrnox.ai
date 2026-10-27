import { StyleSheet, View } from 'react-native';
import type { ChatMessage } from '../../lib/chat';
import { plural } from '../../lib/i18n';
import { withoutDrafts, type StudioDraft } from '../../lib/studioSkills';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { DraftCards } from './DraftCards';

export function MessageBubble({ message, sending, drafts }: { message: ChatMessage; sending: boolean; drafts: readonly StudioDraft[] }) {
    const styles = useThemedStyles(sheets);
    const shown = drafts.length ? withoutDrafts(message.content) : message.content;
    return (
        <View accessible accessibilityLabel={`${message.role === 'user' ? 'You' : 'Assistant'}: ${message.content || (sending ? 'writing' : '')}`} style={[styles.bubble, message.role === 'user' ? styles.user : styles.assistant]}>
            <Text variant="body" style={[styles.text, message.role === 'user' && styles.userText]}>{shown || (sending && !message.content ? '…' : '')}</Text>
            {drafts.length ? <DraftCards drafts={drafts} /> : null}
            {message.role === 'assistant' && message.credits ? <Text variant="caption" style={styles.cost}>{plural('chat.replyCost', message.credits)}</Text> : null}
        </View>
    );
}

const sheets = themedStyles((p, _, scheme) => ({
    bubble: { maxWidth: '88%', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12 },
    user: { alignSelf: 'flex-end', backgroundColor: scheme === 'light' ? p.surface : p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1 },
    assistant: { alignSelf: 'stretch', maxWidth: '100%', backgroundColor: scheme === 'light' ? p.bgElevated1 : p.bgElevated2, borderColor: p.borderSubtle, borderWidth: scheme === 'light' ? StyleSheet.hairlineWidth : 0 },
    text: { color: p.textPrimary },
    userText: { color: p.textPrimary },
    cost: { color: p.warning, fontVariant: ['tabular-nums'], marginTop: 6 },
}));
