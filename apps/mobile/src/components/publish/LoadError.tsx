import { StyleSheet, View } from 'react-native';

import { Button } from '../ui';
import { Text as StatusText } from '../ui/Text';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// A list that failed its first load: the reason, and one way to try again without leaving the screen.
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <View style={styles.box}>
            <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{message}</StatusText>
            <Button variant="secondary" label={t('publishHome.retry')} onPress={onRetry} />
        </View>
    );
}

const styles = StyleSheet.create({
    box: { gap: 12 },
    error: { color: colors.danger },
});
