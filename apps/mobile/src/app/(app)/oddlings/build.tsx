import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { BuilderFields } from '../../../components/oddlings/BuilderFields';
import { HandoffCard } from '../../../components/oddlings/HandoffCard';
import { CategoryList } from '../../../components/oddlings/CategoryList';
import { OddlingFigure } from '../../../components/oddlings/OddlingFigure';
import { PickSheet, type PickChoice } from '../../../components/oddlings/PickSheet';
import { MIN_TARGET } from '../../../lib/a11y';
import { plural, t } from '../../../lib/i18n';
import { findOddling } from '../../../lib/oddlings';
import { CATEGORIES, CATEGORY_FOCUS, GROUPS, MOTIONS, SCENES, SHOWS, TONES, buildStudioPrompt, changePick, groupById, randomizeAll, randomizeStyle, sanitizePicks, swatchOf, type Picks } from '../../../lib/oddlingsBuilder';
import { fileStore, loadDoc, saveDraft, savePassport } from '../../../lib/oddlingsLibrary';
import { colors } from '../../../theme';

const START: Picks = { character_type: 'Human' };
const DRAFT_DELAY_MS = 600;

export default function OddlingBuilder() {
    const router = useRouter();
    const { from, passport } = useLocalSearchParams<{ from?: string; passport?: string }>();
    const [picks, setPicks] = useState<Picks>(START);
    const [scene, setScene] = useState(SCENES[0]);
    const [motionId, setMotionId] = useState(MOTIONS[0].id);
    const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
    const [open, setOpen] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const lastSeen = useRef<string>('');

    // Start from, in order: a cast character, a saved passport, the last draft.
    useEffect(() => {
        let live = true;
        (async () => {
            const cast = findOddling(typeof from === 'string' ? from : undefined);
            if (cast) {
                if (live) { setPicks(sanitizePicks(cast.picks)); setNotice(t('oddlings.build.loaded', { name: cast.name })); }
            } else {
                const doc = await loadDoc(fileStore);
                const item = typeof passport === 'string' ? doc.items.find((i) => i.id === passport) : undefined;
                if (live && item) { setPicks(item.picks); setLoadedId(item.id); setMotionId(item.motionId || MOTIONS[0].id); setNotice(t('oddlings.build.loaded', { name: item.name })); }
                else if (live && doc.draft && Object.keys(doc.draft.picks).length) setPicks(doc.draft.picks);
            }
            if (live) setReady(true);
        })();
        return () => { live = false; };
    }, [from, passport]);

    // The draft is kept as the person works, so leaving the screen loses nothing.
    useEffect(() => {
        if (!ready) return;
        const key = JSON.stringify(picks);
        if (key === lastSeen.current) return;
        lastSeen.current = key;
        const timer = setTimeout(() => { void saveDraft(fileStore, picks, Date.now()); }, DRAFT_DELAY_MS);
        return () => clearTimeout(timer);
    }, [picks, ready]);

    const setPick = useCallback((key: string, value: string) => { setPicks((current) => changePick(current, key, value)); setNotice(null); }, []);
    const prompt = useMemo(() => buildStudioPrompt({ picks, scene }), [picks, scene]);
    const chosen = GROUPS.filter((g) => picks[g.id]).length;

    const sheet = useMemo(() => {
        if (!open) return null;
        if (open === 'motion') return { title: t('oddlings.build.motion'), choices: MOTIONS.map((m) => ({ value: m.id, label: m.name })) as PickChoice[] };
        if (open === 'oddling_voice' || open === 'oddling_show') {
            const table = open === 'oddling_voice' ? TONES : SHOWS;
            return { title: t(open === 'oddling_voice' ? 'oddlings.build.voice' : 'oddlings.build.show'), choices: table.map(([value]) => ({ value, label: value })) as PickChoice[] };
        }
        const group = groupById(open);
        if (!group) return null;
        return { title: group.label, choices: group.options.map(([value, , label]) => ({ value, label, swatch: swatchOf(group.id, value) })) as PickChoice[] };
    }, [open]);

    async function save() {
        const result = await savePassport(fileStore, picks, Date.now(), loadedId, motionId);
        if (result.ok && result.item) { setLoadedId(result.item.id); setNotice(t(loadedId ? 'oddlings.build.updated' : 'oddlings.build.savedOk')); }
        else setNotice(t('oddlings.build.saveFailed'));
    }

    // Clears the look (every character choice) and keeps the name, voice and show that were typed.
    function clearLook() {
        const ids = new Set(GROUPS.map((g) => g.id));
        setPicks((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !ids.has(key))));
        setNotice(t('oddlings.build.cleared'));
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Stack.Screen options={{ title: t('oddlings.build.title') }} />
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <OddlingFigure picks={picks} focus={CATEGORY_FOCUS[categoryId] || 'body'} />
                <Text style={styles.count} accessibilityLiveRegion="polite">{plural('oddlings.build.chosen', chosen)}</Text>
                <Text style={styles.note}>{t('oddlings.build.adults')}</Text>
                <View style={styles.actions}>
                    <Action label={t('oddlings.build.randomize')} onPress={() => { setPicks((c) => randomizeStyle(c)); setNotice(t('oddlings.build.remixed')); }} />
                    <Action label={t('oddlings.build.surprise')} onPress={() => { setPicks((c) => randomizeAll(c)); setNotice(t('oddlings.build.surprised')); }} />
                    <Action label={t('oddlings.build.clear')} disabled={!chosen} onPress={clearLook} />
                </View>
                {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
                <Section>
                    <CategoryList categoryId={categoryId} picks={picks} onCategory={setCategoryId} onOpen={setOpen} />
                </Section>
                <Section>
                    <BuilderFields picks={picks} scene={scene} motionId={motionId} onText={setPick} onOpen={setOpen} onScene={setScene} />
                </Section>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPrompt }} style={styles.promptToggle} onPress={() => setShowPrompt((v) => !v)}>
                    <Text style={styles.link}>{showPrompt ? t('oddlings.build.promptHide') : t('oddlings.build.prompt')}</Text>
                </Pressable>
                {showPrompt ? <Text style={styles.prompt} selectable>{prompt}</Text> : null}
                <HandoffCard picks={picks} scene={scene} motionId={motionId} onLeave={async () => { await savePassport(fileStore, picks, Date.now(), loadedId, motionId).then((r) => { if (r.item) setLoadedId(r.item.id); }); }} />
                <Pressable accessibilityRole="button" style={styles.save} onPress={save}>
                    <Text style={styles.saveText}>{t('oddlings.build.save')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.promptToggle} onPress={() => router.push('/oddlings/saved')}>
                    <Text style={styles.link}>{t('oddlings.build.saved')}</Text>
                </Pressable>
            </ScrollView>
            {sheet && open ? <PickSheet title={sheet.title} choices={sheet.choices} value={open === 'motion' ? motionId : picks[open] || ''} onPick={(v) => (open === 'motion' ? setMotionId(v) : setPick(open, v))} onClose={() => setOpen(null)} /> : null}
        </KeyboardAvoidingView>
    );
}

const Section = ({ children }: { children: React.ReactNode }) => <View style={styles.section}>{children}</View>;

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} style={[styles.action, disabled && styles.off]} onPress={onPress}>
            <Text style={styles.actionText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: VEY_CLEARANCE + 32 },
    count: { color: colors.body, fontSize: 14, marginTop: 12 },
    note: { color: colors.muted, fontSize: 12, marginTop: 4 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    action: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
    off: { opacity: 0.4 },
    actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    notice: { color: colors.accent, fontSize: 13, marginTop: 12 },
    section: { marginTop: 20 },
    promptToggle: { minHeight: MIN_TARGET, justifyContent: 'center', marginTop: 12 },
    link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
    prompt: { color: colors.body, fontSize: 13, lineHeight: 19, backgroundColor: colors.surface, borderRadius: 10, padding: 12 },
    save: { minHeight: MIN_TARGET, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, marginTop: 16 },
    saveText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
});
