import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { accountErrorKey, validNonce, validPassword } from '../../lib/accountSecurity';
import { changePassword, requestPasswordCode } from '../../lib/auth/accountCalls';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';
import { Action, Card, Status, styles } from './shared';

export function PasswordCard() {
    const { getAccessToken } = useAuth();
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

    async function run(action: () => Promise<void>, done: string) {
        setBusy(true);
        setNote(null);
        try {
            await action();
            setNote({ text: done, error: false });
            return true;
        } catch (err) {
            setNote({ text: t(accountErrorKey(err)), error: true });
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function update() {
        if (!validPassword(password)) return setNote({ text: t('acct.pw.tooShort'), error: true });
        if (!validNonce(code)) return setNote({ text: t('acct.pw.badCode'), error: true });
        if (await run(() => changePassword(getAccessToken, password, code), t('acct.pw.done'))) {
            setPassword('');
            setCode('');
        }
    }

    return (
        <Card title={t('acct.pw.title')} help={t('acct.pw.help')}>
            <Action label={t('acct.pw.send')} disabled={busy} onPress={() => void run(() => requestPasswordCode(getAccessToken), t('acct.pw.sent'))} />
            <View style={{ gap: 6 }}>
                <Text style={styles.label}>{t('acct.pw.new')}</Text>
                <TextInput
                    accessibilityLabel={t('acct.pw.new')}
                    style={styles.input}
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="newPassword"
                    maxLength={72}
                    value={password}
                    onChangeText={setPassword}
                    placeholderTextColor={colors.muted}
                />
            </View>
            <View style={{ gap: 6 }}>
                <Text style={styles.label}>{t('acct.pw.code')}</Text>
                <TextInput
                    accessibilityLabel={t('acct.pw.code')}
                    style={styles.input}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={10}
                    value={code}
                    onChangeText={(v) => setCode(v.trim())}
                    placeholderTextColor={colors.muted}
                />
            </View>
            <Action label={t('acct.pw.update')} disabled={busy || !password || !code} onPress={() => void update()} />
            <Status text={note?.text ?? null} error={note?.error} />
        </Card>
    );
}
