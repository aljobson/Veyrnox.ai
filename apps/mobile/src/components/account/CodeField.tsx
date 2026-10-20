import { Text, TextInput, View } from 'react-native';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { styles } from './shared';

export function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t('acct.mfa.code')}</Text>
            <TextInput
                accessibilityLabel={t('acct.mfa.code')}
                style={styles.input}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                value={value}
                onChangeText={(v) => onChange(v.replace(/\D/g, ''))}
                placeholder="000000"
                placeholderTextColor={colors.muted}
            />
        </View>
    );
}
