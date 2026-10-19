import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { askHelp, HELP_MAX_QUESTION, helpErrorKey, validQuestion, type HelpTurn } from '../lib/helpAssistant';
import { t } from '../lib/i18n';
import { colors } from '../theme';
import { Action, Card, Status, styles } from './account/shared';

// Ask Vey a question about the app. Free; the answer is words only.
export function HelpAsk() {
    const { api } = useAuth();
    const [question, setQuestion] = useState('');
    const [turns, setTurns] = useState<HelpTurn[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function send() {
        if (!validQuestion(question) || busy) return;
        const asked = question.trim();
        setBusy(true);
        setError(null);
        try {
            const answer = await askHelp(api, asked, turns);
            setTurns((h): HelpTurn[] => [...h, { role: 'user' as const, content: asked }, { role: 'assistant' as const, content: answer }].slice(-6));
            setQuestion('');
        } catch (err) {
            setError(t(helpErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Card title={t('help.ask.title')} help={t('help.ask.help')}>
            {turns.map((turn, i) => (
                <View key={i} style={{ gap: 2 }}>
                    <Text style={styles.label}>{turn.role === 'user' ? t('help.ask.you') : t('help.ask.vey')}</Text>
                    <Text selectable style={styles.name}>{turn.content}</Text>
                </View>
            ))}
            <TextInput
                accessibilityLabel={t('help.ask.label')}
                placeholder={t('help.ask.placeholder')}
                placeholderTextColor={colors.muted}
                multiline
                maxLength={HELP_MAX_QUESTION}
                style={[styles.input, { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' }]}
                value={question}
                onChangeText={setQuestion}
            />
            <Action label={busy ? t('help.ask.thinking') : t('help.ask.send')} disabled={busy || !validQuestion(question)} onPress={() => void send()} />
            <Status text={error} error />
        </Card>
    );
}
