import { rawText } from '../../lib/i18n/translate';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles } from '../account/shared';
import { selectedState } from '../../lib/a11y';
import { FONTS, FONTS_MAX, NAME_MAX, BRAND_SWATCHES, PALETTE_MAX, kitErrorKey, kitProblem, newSaveKey, saveKit, type Kit, type KitState } from '../../lib/brandKit';
import { t } from '../../lib/i18n';
import { isAccountChanged } from '../../auth/sessionTask';
import type { Project } from '../../lib/projects';
import { assetsOf, nextAssetKey, toAssetRows, type AssetRow, type BrandAsset } from '../../lib/brandKit';
import { BrandTextStyles } from './BrandTextStyles';
import { BrandAssetsEditor } from './BrandAssetsEditor';
import { colors } from '../../theme';

const LIGHT_SWATCHES = new Set(['#ffffff', '#facc15', '#32d6c5', '#22c55e']);
type Draft = { kit: Kit; rows: AssetRow[] };
export function BrandKitEditor({ workspaceId, state, onSaved, catalog = null, projects = null, onCatalogChanged = () => {} }: {
    workspaceId: string; state: KitState; onSaved: (s: KitState) => void;
    catalog?: { list: BrandAsset[]; truncated: boolean } | null; projects?: Project[] | null; onCatalogChanged?: () => void;
}) {
    const { api, beginSessionTask } = useAuth();
    const [draft, setDraft] = useState<Draft>(() => ({ kit: state.kit, rows: toAssetRows(state.kit.assets, nextAssetKey) }));
    const draftRef = useRef(draft), mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const kit = draft.kit;
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
    const attempt = useRef<{ json: string; key: string } | null>(null);
    const locked = !state.canEdit;
    // Colours saved before the swatch list stay selectable, so nothing in a saved kit is lost.
    const known = new Set<string>(BRAND_SWATCHES.map((s) => s.hex));
    const swatches: { id: string; hex: string }[] = [...BRAND_SWATCHES, ...kit.palette.filter((c) => !known.has(c.toLowerCase())).map((c) => ({ id: 'custom', hex: c.toLowerCase() }))];

    const commit = (next: Draft) => { draftRef.current = next; setDraft(next); setNote(null); };
    const set = (patch: Partial<Kit>) => commit({ ...draftRef.current, kit: { ...draftRef.current.kit, ...patch } });
    function onAssetsChange<T>(change: (rows: readonly AssetRow[]) => { next: AssetRow[]; result: T }): T {
        const { next, result } = change(draftRef.current.rows);
        commit({ ...draftRef.current, rows: next });
        return result;
    }

    function toggleColour(hex: string) {
        const kit = draftRef.current.kit;
        if (kit.palette.some((c) => c.toLowerCase() === hex)) {
            if (kit.palette.length <= 1) return;
            return set({ palette: kit.palette.filter((c) => c.toLowerCase() !== hex) });
        }
        if (kit.palette.length >= PALETTE_MAX) return setNote({ text: t('brand.paletteFull', { max: PALETTE_MAX }), error: true });
        set({ palette: [...kit.palette, hex] });
    }

    function toggleFont(font: string) {
        const kit = draftRef.current.kit;
        const has = kit.fonts.includes(font);
        if (!has && kit.fonts.length >= FONTS_MAX) return;
        set({ fonts: has ? kit.fonts.filter((f) => f !== font) : [...kit.fonts, font] });
    }

    async function save() {
        if (locked || busy) return;
        const kit = { ...draftRef.current.kit, assets: assetsOf(draftRef.current.rows) };
        const task = beginSessionTask();
        const live = () => task.current() && mounted.current;
        const problem = kitProblem(kit);
        if (problem) return setNote({ text: t(`brand.problem.${problem}`), error: true });
        // A retry of the same unsent change reuses its key; a different change gets a new one.
        const json = JSON.stringify(kit);
        if (attempt.current?.json !== json) attempt.current = { json, key: newSaveKey() };
        setBusy(true);
        setNote(null);
        try {
            const next = await saveKit(api, workspaceId, state, kit, attempt.current.key, { task });
            if (!live()) return;
            attempt.current = null;
            onSaved(next);
            setNote({ text: t('brand.saved'), error: false });
        } catch (err) {
            if (isAccountChanged(err) || !live()) return;
            setNote({ text: t(kitErrorKey(err, 'save')), error: true });
        } finally {
            if (live()) setBusy(false);
        }
    }

    return (
        <>
            <Card title={t('brand.name')}>
                <TextInput accessibilityLabel={t('brand.name')} editable={!locked} style={styles.input} maxLength={NAME_MAX} value={kit.name} onChangeText={(name) => set({ name })} placeholderTextColor={colors.muted} />
            </Card>
            <Card title={t('brand.palette')} help={t('brand.paletteTap', { max: PALETTE_MAX })}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {swatches.map(({ id, hex }) => {
                        const on = kit.palette.some((c) => c.toLowerCase() === hex);
                        const name = id === 'custom' ? t('brand.swatch.custom') : t(`brand.swatch.${id}`);
                        return (
                            <Pressable
                                key={hex}
                                accessibilityRole="button"
                                accessibilityLabel={rawText(name)}
                                accessibilityState={{ selected: on, disabled: locked }}
                                disabled={locked}
                                onPress={() => toggleColour(hex)}
                                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: hex, borderWidth: on ? 3 : 1, borderColor: on ? colors.accent : colors.border, alignItems: 'center', justifyContent: 'center' }}
                            >
                                {on ? <Text style={{ fontSize: 20, fontWeight: '800', color: LIGHT_SWATCHES.has(hex) ? '#000' : '#fff' }}>✓</Text> : null}
                            </Pressable>
                        );
                    })}
                </View>
            </Card>
            <Card title={t('brand.fonts')}>
                {FONTS.map((font) => {
                    const on = kit.fonts.includes(font);
                    return (
                        <Pressable
                            key={font}
                            accessibilityRole="checkbox"
                            accessibilityLabel={rawText(font)}
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
            <BrandTextStyles styles={kit.textStyles} locked={locked} onChange={textStyles => set({ textStyles })} />
            <BrandAssetsEditor workspaceId={workspaceId} rows={draft.rows} catalog={catalog} projects={projects} locked={locked} onAssetsChange={onAssetsChange} onCatalogChanged={onCatalogChanged} />
            {locked ? <Text style={styles.help}>{t('brand.readOnly')}</Text> : <Action label={busy ? t('brand.saving') : t('brand.save')} disabled={busy} onPress={() => void save()} />}
            <Status text={note?.text ?? null} error={note?.error} />
        </>
    );
}
