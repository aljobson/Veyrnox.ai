import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET, selectedState } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../lib/media';
import { ensureOnline, OfflineError } from '../../lib/network';
import { animateLink, animationCredits, animationModel } from '../../lib/oddlingsAnimate';
import { MOTIONS } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

// Sends the portrait on to Create as the start image of a video model, with the opening move in the words. The price is
// the catalog's and is on the button; Create shows it again and charges only when Generate is pressed there.
export function AnimateCard({ id }: { id: string }) {
    const router = useRouter();
    const [models, setModels] = useState<readonly CatalogModel[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [motionId, setMotionId] = useState(MOTIONS[0].id);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void fetchCatalogCached((data) => { if (live) setModels(data); }).catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, []);

    const model = models ? animationModel(models) : null;
    const price = model ? plural('oddlings.handoff.credits', animationCredits(model)) : failed ? t('oddlings.handoff.noPrice') : models ? t('oddlings.handoff.unavailable') : t('oddlings.handoff.checking');

    async function go() {
        const link = model ? animateLink(model, id, motionId) : null;
        if (!link) return;
        setProblem(null);
        try {
            await ensureOnline();
        } catch (err) {
            if (err instanceof OfflineError) return setProblem(t('oddlings.handoff.offline'));
            throw err;
        }
        router.push(link);
    }

    return (
        <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">{t('oddlings.animate.title')}</Text>
            <Text style={styles.body}>{t('oddlings.animate.body')}</Text>
            <Text style={styles.label}>{t('oddlings.animate.move')}</Text>
            <View style={styles.chips}>
                {MOTIONS.map((m) => (
                    <Pressable key={m.id} accessibilityRole="button" accessibilityState={selectedState(m.id === motionId)} style={[styles.chip, m.id === motionId && styles.chipOn]} onPress={() => setMotionId(m.id)}>
                        <Text style={[styles.chipText, m.id === motionId && styles.chipTextOn]}>{m.name}</Text>
                    </Pressable>
                ))}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('oddlings.animate.action')}. ${price}`} accessibilityState={{ disabled: !model }} disabled={!model} style={[styles.choice, !model && styles.off]} onPress={() => void go()}>
                <Text style={styles.choiceText}>{t('oddlings.animate.action')}</Text>
                <Text style={styles.price}>{price}</Text>
            </Pressable>
            {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 20, gap: 10 },
    title: { color: colors.text, fontSize: 17, fontWeight: '800' },
    body: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    label: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { minHeight: MIN_TARGET, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 13 },
    chipTextOn: { color: colors.accentInk, fontWeight: '700' },
    choice: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 8 },
    off: { opacity: 0.5 },
    choiceText: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
    price: { color: colors.money, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
    problem: { color: colors.danger, fontSize: 13 },
});
