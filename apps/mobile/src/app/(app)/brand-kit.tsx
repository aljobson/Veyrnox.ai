import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles as shared } from '../../components/account/shared';
import { BrandKitEditor } from '../../components/brand/BrandKitEditor';
import { fetchBrandAssets, fetchKit, kitErrorKey, type BrandAsset, type KitState } from '../../lib/brandKit';
import { t } from '../../lib/i18n';
import { fetchWorkspaces, type Workspace } from '../../lib/projects';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { colors } from '../../theme';

const sizeLabel = (b: number | null) => (b === null ? '' : b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`);

// Brand kit and brand assets for a workspace (parity P7). Off on the server until the editor's shared tools are on:
// the routes then answer 404 and this says so.
export default function BrandKit() {
    const { api } = useAuth();
    const [spaces, setSpaces] = useState<Workspace[] | null>(null);
    const [spaceId, setSpaceId] = useState<string | null>(null);
    const [state, setState] = useState<KitState | null>(null);
    const [assets, setAssets] = useState<{ list: BrandAsset[]; truncated: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchWorkspaces(api).then(
            (list) => {
                setSpaces(list);
                setSpaceId((list.find((w) => w.isDefault) ?? list[0])?.id ?? null);
            },
            (err) => setError(t(kitErrorKey(err))),
        );
    }, [api]);

    const load = useCallback(async (id: string) => {
        setState(null);
        setAssets(null);
        setError(null);
        try {
            setState(await fetchKit(api, id));
            const a = await fetchBrandAssets(api, id).catch(() => null);
            setAssets(a ? { list: a.assets, truncated: a.truncated } : { list: [], truncated: false });
        } catch (err) {
            setError(t(kitErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        if (spaceId) void load(spaceId);
    }, [spaceId, load]);

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Stack.Screen options={{ title: t('brand.title') }} />
            <Text style={shared.help}>{t('brand.intro')}</Text>
            {spaces && spaces.length > 1 ? (
                <View style={styles.chips} accessibilityRole="tablist">
                    {spaces.map((w) => (
                        <Pressable key={w.id} accessibilityRole="tab" accessibilityState={{ selected: w.id === spaceId }} onPress={() => setSpaceId(w.id)} style={[styles.chip, w.id === spaceId && styles.chipOn]}>
                            <Text style={{ color: colors.text }}>{w.name}</Text>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {spaces && spaces.length === 0 ? <Text style={shared.help}>{t('brand.noWorkspace')}</Text> : null}
            {error ? (
                <>
                    <Status text={error} error />
                    {spaceId ? <Action label={t('acct.mfa.retry')} onPress={() => void load(spaceId)} /> : null}
                </>
            ) : !state && spaceId ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t('brand.loading')} />
            ) : null}
            {state && spaceId ? <BrandKitEditor key={spaceId} workspaceId={spaceId} state={state} onSaved={setState} /> : null}
            {assets ? (
                <Card title={t('brand.assets')} help={t('brand.assetsHelp')}>
                    {assets.list.length === 0 ? <Text style={shared.help}>{t('brand.assetsNone')}</Text> : null}
                    {assets.list.map((a) => (
                        <Text key={a.id} style={shared.name}>
                            {[a.type, a.width && a.height ? `${a.width}×${a.height}` : '', a.seconds ? `${a.seconds}s` : '', sizeLabel(a.bytes)].filter(Boolean).join(' · ')}
                        </Text>
                    ))}
                    {assets.truncated ? <Text style={shared.help}>{t('brand.assetsMore')}</Text> : null}
                </Card>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 16 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipOn: { borderColor: colors.accent },
});
