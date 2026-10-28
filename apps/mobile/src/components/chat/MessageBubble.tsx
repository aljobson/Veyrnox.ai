import { StyleSheet, View } from 'react-native';
import type { ChatMessage } from '../../lib/chat';
import { t, plural } from '../../lib/i18n';
import { withoutDrafts, type StudioDraft } from '../../lib/studioSkills';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { ChatText, replyActions } from './ChatText';
import { ReplyFooter, eligibleReply } from './ReplyFooter';
import { DraftCards } from './DraftCards';

export function MessageBubble({ message, sending, drafts, selected, onStar }: { message: ChatMessage; sending: boolean; drafts: readonly StudioDraft[]; selected?: boolean; onStar?: () => void }) {
    const styles = useThemedStyles(sheets);
    const shown = message.role === 'assistant' ? withoutDrafts(message.content) : message.content;
    const label = `${message.role === 'user' ? t('chat.speakerYou') : t('chat.speakerAssistant')}: ${shown || (sending ? t('chat.writing') : '')}`;
    const actions = replyActions(shown);
    return (
        <View style={[styles.bubble, message.role === 'user' ? styles.user : styles.assistant]}>
            {message.role === 'assistant' ? <View accessible accessibilityLabel={label}
                accessibilityActions={actions.map(({ name, label }) => ({ name, label }))}
                onAccessibilityAction={event => { void actions.find(a => a.name === event.nativeEvent.actionName)?.run(); }}>
                <ChatText content={shown || (sending && !message.content ? '…' : '')} />
            </View> : <Text accessible accessibilityLabel={label} variant="body" style={[styles.text, styles.userText]}>{shown}</Text>}
            {eligibleReply(message) ? <ReplyFooter message={message} selected={selected} onStar={onStar} /> : null}
            {drafts.length ? <DraftCards drafts={drafts} /> : null}
            {message.role === 'assistant' && !eligibleReply(message) && message.credits ? <Text variant="caption" style={styles.cost}>{plural('chat.replyCost', message.credits)}</Text> : null}
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
