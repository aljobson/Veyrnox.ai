import { View } from 'react-native';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
export function MusicNotice({ message, retry, announce = true }: { message: string; retry?: () => void; announce?: boolean }) {
    useAnnouncement(announce ? message : null, { onMount: true, everywhere: true });
    return <View><Text variant="callout" accessibilityRole={announce ? 'alert' : undefined}>{message}</Text>
        {retry ? <Button variant="secondary" label={t('music.retry')} onPress={retry} /> : null}</View>;
}
