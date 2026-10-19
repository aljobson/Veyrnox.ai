import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import type { StudioDraft } from '../../lib/studioSkills';
import { colors } from '../../theme';

// A skill's result: one card per draft. Create opens with the model and the prompt filled in and shows its own price; nothing
// is made or charged until the person presses Create there.
export function DraftCards({ drafts }: { drafts: readonly StudioDraft[] }) {
    const router = useRouter();
    return (
        <View style={styles.wrap}>
            {drafts.map((d, i) => (
                <Pressable
                    key={`${d.model}-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('chat.draft.open')}: ${d.name}, ${plural('chat.draft.price', d.credits)}`}
                    style={styles.card}
                    onPress={() => router.push({ pathname: '/create/[modelId]', params: { modelId: d.model, prompt: d.prompt } })}
                >
                    <Text style={styles.name}>{d.name} · {plural('chat.draft.price', d.credits)}</Text>
                    <Text style={styles.prompt} numberOfLines={3}>{d.prompt}</Text>
                    <Text style={styles.open}>{t('chat.draft.open')}</Text>
                    {d.needs.length > 0 ? <Text style={styles.prompt}>{t('chat.draft.needs')}</Text> : null}
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { gap: 8, marginTop: 8 },
    card: { minHeight: MIN_TARGET, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, gap: 4 },
    name: { color: colors.text, fontWeight: '600' },
    prompt: { color: colors.body, fontSize: 13 },
    open: { color: colors.accent },
});
