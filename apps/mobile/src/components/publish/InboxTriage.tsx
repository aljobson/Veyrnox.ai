import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Text, TextField } from '../ui';
import { themedStyles, useThemedStyles } from '../ui/AppearanceContext';
import { t } from '../../lib/i18n';
import { PRIORITIES, parseThreadTags, type Priority } from '../../lib/publishInboxList';

export function InboxTriage({ priority, tags, busy, onPriority, onTags }: {
    priority: string; tags: string[]; busy: boolean; onPriority: (p: Priority) => void; onTags: (tags: string[]) => void;
}) {
    const [text, setText] = useState(tags.join(', ')), [error, setError] = useState<string | null>(null);
    const s = useThemedStyles(sheets), joined = tags.join(', ');
    useEffect(() => { setText(joined); setError(null); }, [joined]);
    return <Card style={s.card} accessibilityState={{ busy }}>
        <Text accessibilityRole="header">{t('publishOps.inbox.priority')}</Text>
        <View style={s.chips}>{PRIORITIES.map(p => <Chip key={p} label={t(`publishOps.priority.${p}`)} selected={priority === p} disabled={busy} onPress={() => onPriority(p)} />)}</View>
        <TextField label={t('publishOps.inbox.tags')} value={text} onChangeText={setText} maxLength={320} editable={!busy} />
        {error ? <Text tone="danger" accessibilityRole="alert">{t(error)}</Text> : null}
        <Button label={t('publishOps.inbox.saveTags')} disabled={busy} onPress={() => {
            const parsed = parseThreadTags(text);
            if (parsed.error) { setError(parsed.error); return; }
            setError(null); onTags(parsed.tags!);
        }} />
    </Card>;
}
const sheets = themedStyles(() => ({ card: { gap: 8 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
