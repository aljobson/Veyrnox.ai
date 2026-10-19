import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../lib/media';
import { ensureOnline, OfflineError } from '../../lib/network';
import { offerFor, portraitLink, portraitModel, shortLink, shortModel, type Offer } from '../../lib/oddlingsHandoff';
import type { Picks } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

interface Props {
    picks: Picks;
    scene: string;
    // Keeps the character before leaving, so coming back finds it.
    onLeave: () => Promise<void>;
}

type Which = 'portrait' | 'short';

// Sends the character on to Create. The price comes from the catalog and is on the button; Create shows it again and
// charges only when Generate is pressed there. Offline, nothing opens.
export function HandoffCard({ picks, scene, onLeave }: Props) {
    const router = useRouter();
    const [models, setModels] = useState<readonly CatalogModel[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void fetchCatalogCached((data) => { if (live) setModels(data); }).catch(() => { if (live) setProblem(t('oddlings.handoff.noPrice')); });
        return () => { live = false; };
    }, []);

    const portrait = models ? portraitModel(models) : null;
    const short = models ? shortModel(models) : null;

    async function go(which: Which, model: CatalogModel) {
        setProblem(null);
        try {
            await ensureOnline();
        } catch (err) {
            if (err instanceof OfflineError) return setProblem(t('oddlings.handoff.offline'));
            throw err;
        }
        await onLeave();
        router.push(which === 'portrait' ? portraitLink(model, picks, scene) : shortLink(model, picks, scene));
    }

    return (
        <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">{t('oddlings.handoff.title')}</Text>
            <Text style={styles.body}>{t('oddlings.handoff.body')}</Text>
            <Choice label={t('oddlings.handoff.portrait')} offer={offerFor(portrait)} loading={!models && !problem} onPress={() => portrait && go('portrait', portrait)} />
            <Choice label={t('oddlings.handoff.short')} offer={offerFor(short)} loading={!models && !problem} onPress={() => short && go('short', short)} />
            {problem ? <Text style={styles.problem} accessibilityLiveRegion="polite">{problem}</Text> : null}
        </View>
    );
}

function Choice({ label, offer, loading, onPress }: { label: string; offer: Offer | null; loading: boolean; onPress: () => void }) {
    const price = offer ? plural('oddlings.handoff.credits', offer.credits) : loading ? t('oddlings.handoff.checking') : t('oddlings.handoff.unavailable');
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${price}`} accessibilityState={{ disabled: !offer }} disabled={!offer} style={[styles.choice, !offer && styles.off]} onPress={onPress}>
            <Text style={styles.choiceText}>{label}</Text>
            <Text style={styles.price}>{price}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 20, gap: 10 },
    title: { color: colors.text, fontSize: 17, fontWeight: '800' },
    body: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    choice: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 8 },
    off: { opacity: 0.5 },
    choiceText: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
    price: { color: colors.money, fontSize: 14, fontWeight: '700' },
    problem: { color: colors.danger, fontSize: 13 },
});
