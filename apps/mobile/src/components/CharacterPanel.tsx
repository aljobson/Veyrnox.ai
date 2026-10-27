import { displayLabel } from '../lib/displayLabels';
import { Text, Button, Card, themedStyles, useThemedStyles } from './ui';
import { useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { MIN_TARGET } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { CATEGORIES, GROUPS, changePick, groupById, randomizeStyle, swatchOf, type Picks } from '../lib/oddlingsBuilder';
import { ds } from '../theme';
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
    const styles = useThemedStyles(sheets);
    const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
    const [open, setOpen] = useState<string | null>(null);
    const chosen = GROUPS.filter((g) => picks[g.id]).length;

    const sheet = useMemo(() => {
        const group = open ? groupById(open) : null;
        if (!group) return null;
        return { title: displayLabel(group.label), choices: group.options.map(([value, , label]) => ({ value, label: displayLabel(label), swatch: swatchOf(group.id, value) })) as PickChoice[] };
    }, [open]);

    return (
        <Card style={styles.box}>
            <View style={styles.head}>
                <Text variant="title3" tone="primary" style={styles.title} accessibilityRole="header">{t('char.title')}</Text>
                <Switch accessibilityLabel={t('char.title')} value={on} onValueChange={onToggle} trackColor={{ true: styles.accentInk.color, false: styles.borderInk.color }} />
            </View>
            {on ? null : <Text variant="caption" tone="tertiary" style={styles.muted}>{t('char.offHint')}</Text>}
            {on ? (
                <>
                    <Text variant="caption" tone="tertiary" style={styles.muted}>{t('char.help')}</Text>
                    <Text variant="footnote" tone="secondary" style={styles.count} accessibilityLiveRegion="polite">{plural('oddlings.build.chosen', chosen)}</Text>
                    <View style={styles.actions}>
                        <Action label={t('oddlings.build.randomize')} onPress={() => onChange(randomizeStyle(picks))} />
                        <Action label={t('oddlings.build.clear')} disabled={chosen === 0} onPress={() => onChange({})} />
                    </View>
                    <CategoryList categoryId={categoryId} picks={picks} onCategory={setCategoryId} onOpen={setOpen} />
                    <Text variant="caption" tone="tertiary" style={styles.muted}>{t('oddlings.build.adults')}</Text>
                </>
            ) : null}
            {sheet && open ? <PickSheet title={sheet.title} choices={sheet.choices} value={picks[open] || ''} onPick={(v) => onChange(changePick(picks, open, v))} onClose={() => setOpen(null)} /> : null}
        </Card>
    );
}

function Action({ label, onPress, disabled }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) {
    const styles = useThemedStyles(sheets);
    return (
        <Button variant="secondary" accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} label={label} />
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    borderInk: { color: p.borderSubtle },

    box: { backgroundColor: p.bgElevated1, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: ds.radius.md, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, gap: ds.space.sm },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: MIN_TARGET },
    title: { color: p.textPrimary, },
    muted: { color: p.textTertiary, marginTop: -6, paddingBottom: ds.space.sm },
    count: { color: p.textSecondary, },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm },
}));
