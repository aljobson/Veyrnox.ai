import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import type { StudioDraft } from '../../lib/studioSkills';
import { Text, Card, themedStyles, useThemedStyles } from '../ui';

// A skill's result: one card per draft. Create opens with the model and the prompt filled in and shows its own price; nothing
// is made or charged until the person presses Create there.
export function DraftCards({ drafts }: { drafts: readonly StudioDraft[] }) {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    return (
        <View style={styles.wrap}>
            {drafts.map((d, i) => (
                <Card
                    key={`${d.model}-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('chat.draft.open')}: ${d.name}, ${plural('chat.draft.price', d.credits)}`}
                    style={styles.card}
                    onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: d.model, prompt: d.prompt } })}
                >
                    <Text variant="bodyStrong" style={styles.name}>{d.name} · <Text tone="warning">{plural('chat.draft.price', d.credits)}</Text></Text>
                    <Text variant="footnote" style={styles.prompt} numberOfLines={3}>{d.prompt}</Text>
                    <Text style={styles.open}>{t('chat.draft.open')}</Text>
                    {d.needs.length > 0 ? <Text variant="footnote" style={styles.prompt}>{t('chat.draft.needs')}</Text> : null}
                </Card>
            ))}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    wrap: { gap: 8, marginTop: 8 },
    card: { minHeight: MIN_TARGET, padding: 10, gap: 4 },
    name: { color: p.textPrimary },
    prompt: { color: p.textSecondary },
    open: { color: p.accent },
}));
