import { Share, View } from 'react-native';
import { type ChatMessage } from '../../lib/chat';
import { withoutDrafts } from '../../lib/studioSkills';
import { t, plural } from '../../lib/i18n';
import { touchTarget } from '../../lib/a11y';
import { Button, Icon, Text, themedStyles, useThemedStyles } from '../ui';

export function eligibleReply(message: ChatMessage): boolean {
    return message.role === 'assistant' && ['complete', 'canceled', 'error'].includes(message.status ?? '') && /^[0-9a-f-]{36}$/i.test(message.id);
}
export function ReplyFooter({ message, selected = false, onStar }: { message: ChatMessage; selected?: boolean; onStar?: () => void }) {
    const styles = useThemedStyles(sheets);
    if (!eligibleReply(message)) return null;
    const price = message.credits === 0 ? t('chatDepth.free') : typeof message.credits === 'number' && message.credits > 0 ? plural('chat.replyCost', message.credits) : '';
    const label = message.status === 'error' ? t('chatDepth.cutOff') : message.status === 'canceled' ? t('chatDepth.stopped', { price }) : price;
    return <View style={styles.footer}>
        {label ? <Text variant="caption" style={styles.cost}>{label}</Text> : null}
        <Button variant="tertiary" label={t('chatDepth.copy')} accessibilityLabel={t('chatDepth.copyLabel')} containerStyle={touchTarget}
            onPress={() => { void Share.share({ message: withoutDrafts(message.content) }).catch(() => undefined); }} />
        <Button variant="tertiary" label={t(selected ? 'chatDepth.unstarLabel' : 'chatDepth.starLabel')} accessibilityRole="button"
            accessibilityState={{ selected }} containerStyle={touchTarget} onPress={onStar}>
            <Icon name={selected ? 'starFill' : 'star'} size={20} />
        </Button>
    </View>;
}
const sheets = themedStyles(p => ({ footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, cost: { color: p.warning, fontVariant: ['tabular-nums'], marginTop: 6 } }));
