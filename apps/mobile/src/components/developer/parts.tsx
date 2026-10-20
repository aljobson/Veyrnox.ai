import { Pressable, Share, Text, View } from 'react-native';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Action, Card, styles } from '../account/shared';

// A key or signing secret, shown once. It lives only in the screen's memory: "I have saved it" removes it, and so does
// leaving the screen. Share opens the system sheet so it can go to a password manager; nothing is logged or stored.
export function SecretCard({ title, secret, onDone }: { title: string; secret: string; onDone: () => void }) {
    return (
        <Card title={title} help={t('dev.secret.once')}>
            <Text selectable style={styles.name} accessibilityLabel={t('dev.secret.spoken')}>{secret}</Text>
            <Action label={t('dev.secret.share')} onPress={() => void Share.share({ message: secret }).catch(() => undefined)} />
            <Action label={t('dev.secret.saved')} onPress={onDone} />
        </Card>
    );
}

export function Choice({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
            <Text style={{ color: colors.accent, width: 20 }}>{on ? '✓' : ''}</Text>
            <Text style={{ color: colors.text, fontSize: 15, flexShrink: 1 }}>{label}</Text>
        </Pressable>
    );
}

export function Row({ children }: { children: React.ReactNode }) {
    return <View style={{ gap: 4 }}>{children}</View>;
}

export const shortDate = (iso: string | null): string => {
    if (!iso || Number.isNaN(Date.parse(iso))) return '';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
