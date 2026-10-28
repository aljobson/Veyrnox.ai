import { Text as StatusText } from '../ui/Text';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { chatApi } from '../../lib/chat';
import { oddlingChatInstructions } from '../../lib/oddlingsChat';
import { SKILL_MODEL } from '../../lib/studioSkills';
import type { GenerationReference } from '../../lib/sources';
import { CreditBanner } from './CreditBanner';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { plural, t } from '../../lib/i18n';
import { fetchCatalog, fetchCatalogCached, type CatalogModel } from '../../lib/media';
import { ensureOnline, OfflineError } from '../../lib/network';
import { offerFor, portraitHandoff, portraitModel, shortLink, shortModel, type Offer } from '../../lib/oddlingsHandoff';
import type { Picks } from '../../lib/oddlingsBuilder';
import { colors } from '../../theme';

interface Props {
    picks: Picks;
    scene: string;
    motionId: string;
    references?: readonly GenerationReference[];
    referenceNote?: string;
    referenceBusy?: boolean;
    // Keeps the character before leaving, so coming back finds it.
    onLeave: () => Promise<void>;
}

type Which = 'portrait' | 'short' | 'chat';

// Sends the character on to Create. The price comes from the catalog and is on the button; Create shows it again and
// charges only when Generate is pressed there. Offline, nothing opens.
export function HandoffCard({ picks, scene, motionId, onLeave, references = [], referenceNote = '', referenceBusy = false }: Props) {
    const router = useRouter();
    const { api } = useAuth();
    const launch = useRef(0);
    const mounted = useRef(true);
    const busy = useRef(false);
    const [opening, setOpening] = useState<Which | null>(null);
    const [owner, setOwner] = useState(getCacheUser());
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeCacheUser(() => {
            launch.current++; busy.current = false; setOpening(null); setProblem(null); setModels(null); setOwner(getCacheUser());
        });
        return () => { mounted.current = false; launch.current++; busy.current = false; unsubscribe(); };
    }, []);
    const [models, setModels] = useState<readonly CatalogModel[] | null>(null);
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        void fetchCatalogCached((data) => { if (live && owner === getCacheUser()) setModels(data); }).catch(() => { if (live && owner === getCacheUser()) setProblem(t('oddlings.handoff.noPrice')); });
        return () => { live = false; };
    }, [owner]);

    const portrait = models ? portraitModel(models, { reference: references.length > 0 }) : null;
    const short = models ? shortModel(models) : null;

    async function go(which: Which, model?: CatalogModel) {
        if (busy.current || (which === 'portrait' && referenceBusy)) return;
        const run = ++launch.current, account = getCacheUser();
        const current = () => run === launch.current && account === getCacheUser() && mounted.current;
        const input = { picks: { ...picks }, scene, referenceNote, motionId };
        const sources = references.map(reference => ({ ...reference }));
        busy.current = true; setOpening(which); setProblem(null);
        try {
            await ensureOnline();
            if (!current()) return;
            await onLeave();
            if (!current()) return;
            if (which === 'chat') {
                const available = await chatApi(api).listModels();
                if (!current()) return;
                const open = available.filter(item => !item.gated);
                const chosen = open.find(item => item.id === SKILL_MODEL) ?? open[0];
                if (!chosen) throw new Error('no_model');
                const catalog = await fetchCatalog();
                if (!current()) return;
                const system_prompt = oddlingChatInstructions(input, catalog);
                if (!system_prompt) throw new Error('no_instructions');
                const thread = await chatApi(api).createThread(chosen.id);
                if (!current()) return;
                await chatApi(api).updateThread(thread.id, { system_prompt });
                if (!current()) return;
                router.replace({ pathname: '/chat/[id]', params: { id: thread.id, starter: t('oddlingsStudio.chatStarter') } });
            } else if (which === 'portrait') {
                const handoff = portraitHandoff({ ...input, models: models ?? [], references: sources });
                if (handoff) router.push(handoff.href);
            } else if (model) router.push(shortLink(model, input.picks, scene, motionId));
        } catch (err) {
            if (current()) setProblem(t(which === 'chat' ? 'oddlingsStudio.chatHandoffFailed' : err instanceof OfflineError ? 'oddlings.handoff.offline' : 'oddlings.handoff.noPrice'));
        } finally {
            if (current()) { busy.current = false; setOpening(null); }
        }
    }

    return (
        <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">{t('oddlings.handoff.title')}</Text>
            <Text style={styles.body}>{t('oddlings.handoff.body')}</Text>
            <Choice label={t('oddlings.handoff.portrait')} offer={offerFor(portrait)} loading={!models && !problem} disabled={!!opening || referenceBusy} onPress={() => portrait && go('portrait', portrait)} />
            <Choice label={t('oddlings.handoff.short')} offer={offerFor(short)} loading={!models && !problem} disabled={!!opening} onPress={() => short && go('short', short)} />
            <CreditBanner cost={offerFor(portrait)?.credits ?? null} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!opening }} disabled={!!opening} style={styles.choice} onPress={() => void go('chat')}>
                <Text style={styles.choiceText}>{t(opening === 'chat' ? 'oddlingsStudio.openingChat' : 'oddlingsStudio.refineChat')}</Text>
            </Pressable>
            {problem ? <StatusText variant="inherit" style={styles.problem} accessibilityLiveRegion="polite">{problem}</StatusText> : null}
        </View>
    );
}

function Choice({ label, offer, loading, onPress, disabled = false }: { label: string; offer: Offer | null; loading: boolean; disabled?: boolean; onPress: () => void }) {
    const price = offer ? plural('oddlings.handoff.credits', offer.credits) : loading ? t('oddlings.handoff.checking') : t('oddlings.handoff.unavailable');
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${price}`} accessibilityState={{ disabled: !offer || disabled }} disabled={!offer || disabled} style={[styles.choice, (!offer || disabled) && styles.off]} onPress={onPress}>
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
