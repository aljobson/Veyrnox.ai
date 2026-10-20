import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles } from '../account/shared';
import { selectedState } from '../../lib/a11y';
import { FONTS, FONTS_MAX, NAME_MAX, PALETTE_MAX, kitErrorKey, kitProblem, newSaveKey, normaliseColour, saveKit, type Kit, type KitState } from '../../lib/brandKit';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Edits the name, colours and fonts of one workspace's kit. Text styles and attached assets are carried through
// untouched on every save.
export function BrandKitEditor({ workspaceId, state, onSaved }: { workspaceId: string; state: KitState; onSaved: (s: KitState) => void }) {
    const { api } = useAuth();
    const [kit, setKit] = useState<Kit>(state.kit);
    const [colour, setColour] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
    const attempt = useRef<{ json: string; key: string } | null>(null);
    const locked = !state.canEdit;

    const set = (patch: Partial<Kit>) => {
        setNote(null);
        setKit((k) => ({ ...k, ...patch }));
    };

    function addColour() {
        const c = normaliseColour(colour);
        if (!c) return setNote({ text: t('brand.colourInvalid'), error: true });
        if (kit.palette.includes(c)) return setColour('');
        if (kit.palette.length >= PALETTE_MAX) return setNote({ text: t('brand.paletteFull', { max: PALETTE_MAX }), error: true });
        set({ palette: [...kit.palette, c] });
        setColour('');
    }

    function toggleFont(font: string) {
        const has = kit.fonts.includes(font);
        if (!has && kit.fonts.length >= FONTS_MAX) return;
        set({ fonts: has ? kit.fonts.filter((f) => f !== font) : [...kit.fonts, font] });
    }

    async function save() {
        const problem = kitProblem(kit);
        if (problem) return setNote({ text: t(`brand.problem.${problem}`), error: true });
        // A retry of the same unsent change reuses its key; a different change gets a new one.
        const json = JSON.stringify(kit);
        if (attempt.current?.json !== json) attempt.current = { json, key: newSaveKey() };
        setBusy(true);
        setNote(null);
        try {
            const next = await saveKit(api, workspaceId, state, kit, attempt.current.key);
            attempt.current = null;
            onSaved(next);
            setNote({ text: t('brand.saved'), error: false });
        } catch (err) {
            setNote({ text: t(kitErrorKey(err)), error: true });
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Card title={t('brand.name')}>
                <TextInput accessibilityLabel={t('brand.name')} editable={!locked} style={styles.input} maxLength={NAME_MAX} value={kit.name} onChangeText={(name) => set({ name })} placeholderTextColor={colors.muted} />
            </Card>
            <Card title={t('brand.palette')} help={t('brand.paletteHelp', { max: PALETTE_MAX })}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {kit.palette.map((c) => (
                        <Pressable
                            key={c}
                            accessibilityRole="button"
                            accessibilityLabel={t('brand.removeColour', { colour: c })}
                            disabled={locked || kit.palette.length <= 1}
                            onPress={() => set({ palette: kit.palette.filter((x) => x !== c) })}
                            style={{ minHeight: 44, minWidth: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: c, justifyContent: 'flex-end', padding: 4 }}
                        >
                            <Text style={{ fontSize: 11, color: '#000', backgroundColor: '#ffffffcc', paddingHorizontal: 3, borderRadius: 4 }}>{c}</Text>
                        </Pressable>
                    ))}
                </View>
                {locked ? null : (
                    <>
                        <TextInput
                            accessibilityLabel={t('brand.addColour')}
                            placeholder="#32d6c5"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="none"
                            autoCorrect={false}
                            maxLength={7}
                            style={styles.input}
                            value={colour}
                            onChangeText={setColour}
                        />
                        <Action label={t('brand.addColour')} onPress={addColour} />
                    </>
                )}
            </Card>
            <Card title={t('brand.fonts')}>
                {FONTS.map((font) => {
                    const on = kit.fonts.includes(font);
                    return (
                        <Pressable
                            key={font}
                            accessibilityRole="checkbox"
                            accessibilityLabel={font}
                            accessibilityState={{ checked: on, disabled: locked, ...selectedState(on) }}
                            disabled={locked}
                            onPress={() => toggleFont(font)}
                            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                        >
                            <Text style={{ color: colors.accent, width: 20 }}>{on ? '✓' : ''}</Text>
                            <Text style={{ color: colors.text, fontSize: 16, fontFamily: font === 'monospace' || font === 'Courier New' ? 'Courier' : undefined }}>{font}</Text>
                        </Pressable>
                    );
                })}
            </Card>
            <Card title={t('brand.kept')} help={t('brand.keptHelp', { styles: kit.textStyles.length, assets: kit.assets.length })}>
                <Text style={styles.help}>{t('brand.keptNote')}</Text>
            </Card>
            {locked ? <Text style={styles.help}>{t('brand.readOnly')}</Text> : <Action label={busy ? t('brand.saving') : t('brand.save')} disabled={busy} onPress={() => void save()} />}
            <Status text={note?.text ?? null} error={note?.error} />
        </>
    );
}
