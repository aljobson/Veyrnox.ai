import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { Text, TextField, themedStyles, useThemedStyles } from '../ui';

export function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.fieldGroup}>
            <Text variant="footnote" tone="secondary">{t('acct.mfa.code')}</Text>
            <TextField
                accessibilityLabel={t('acct.mfa.code')}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                value={value}
                onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
                placeholder="000000"
            />
        </View>
    );
}

const sheets = themedStyles(() => ({
    fieldGroup: { gap: 6 },
}));
