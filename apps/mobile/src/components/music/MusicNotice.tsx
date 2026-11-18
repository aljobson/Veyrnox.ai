import { View } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
export function MusicNotice({ message, retry }: { message: string; retry?: () => void }) {
    useAnnouncement(message, { onMount: true, everywhere: true });
    return <View><Text variant="callout" accessibilityRole="alert">{message}</Text>
        {retry ? <Button variant="secondary" label={t('music.retry')} onPress={retry} /> : null}</View>;
}
