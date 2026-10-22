import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { CATEGORIES, GROUPS, changePick, groupById, randomizeStyle, swatchOf, type Picks } from '../lib/oddlingsBuilder';
import { colors } from '../theme';
import { CategoryList } from './oddlings/CategoryList';
import { PickSheet, type PickChoice } from './oddlings/PickSheet';

interface Props {
    readonly on: boolean;
    readonly picks: Picks;
    readonly onToggle: (on: boolean) => void;
    readonly onChange: (next: Picks) => void;
}

// The web's Character panel for image models (ADR-0176): traits become words in the prompt, so the same original adult
// can be made again. It reuses the Oddlings builder's data, picker and rules (ADR-0158) and adds nothing of its own to
// them. It changes the prompt only, never the model or the price.
export function CharacterPanel({ on, picks, onToggle, onChange }: Props) {
    const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
    const [open, setOpen] = useState<string | null>(null);
    const chosen = GROUPS.filter((g) => picks[g.id]).length;

    const sheet = useMemo(() => {
        const group = open ? groupById(open) : null;
        if (!group) return null;
        return { title: group.label, choices: group.options.map(([value, , label]) => ({ value, label, swatch: swatchOf(group.id, value) })) as PickChoice[] };
    }, [open]);

    return (
        <View style={styles.box}>
            <View style={styles.head}>
                <Text style={styles.title} accessibilityRole="header">{t('char.title')}</Text>
                <Switch accessibilityLabel={t('char.title')} value={on} onValueChange={onToggle} trackColor={{ true: colors.accent, false: colors.border }} />
            </View>
            {on ? null : <Text style={styles.muted}>{t('char.offHint')}</Text>}
            {on ? (
                <>
                    <Text style={styles.muted}>{t('char.help')}</Text>
                    <Text style={styles.count} accessibilityLiveRegion="polite">{plural('oddlings.build.chosen', chosen)}</Text>
                    <View style={styles.actions}>
                        <Action label={t('oddlings.build.randomize')} onPress={() => onChange(randomizeStyle(picks))} />
                        <Action label={t('oddlings.build.clear')} disabled={chosen === 0} onPress={() => onChange({})} />
                    </View>
                    <CategoryList categoryId={categoryId} picks={picks} onCategory={setCategoryId} onOpen={setOpen} />
                    <Text style={styles.muted}>{t('oddlings.build.adults')}</Text>
                </>
            ) : null}
            {sheet && open ? <PickSheet title={sheet.title} choices={sheet.choices} value={picks[open] || ''} onPick={(v) => onChange(changePick(picks, open, v))} onClose={() => setOpen(null)} /> : null}
        </View>
    );
}

function Action({ label, onPress, disabled }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) {
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} style={[styles.action, disabled && styles.off]} onPress={onPress}>
            <Text style={styles.actionText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    box: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: MIN_TARGET },
    title: { color: colors.text, fontWeight: '600', fontSize: 16 },
    muted: { color: colors.muted, fontSize: 12, marginTop: -6, paddingBottom: 6 },
    count: { color: colors.body, fontSize: 14 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: MIN_TARGET, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.background },
    off: { opacity: 0.4 },
    actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
