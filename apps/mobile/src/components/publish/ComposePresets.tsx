import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { ApiError, type ApiClient } from '../../lib/api';
import { subscribeCacheUser } from '../../lib/appCache';
import { t } from '../../lib/i18n';
import { brandStore } from '../../lib/publishBrand';
import { applyPreset, deletePreset, fetchPresets, presetDraftProblem, presetErrorKey, presetScopeToken, savePreset, type Preset } from '../../lib/publishPresets';
import { colors } from '../../theme';

type Account = { id: string };
export function ComposePresets({ api, text, networkText, mode, selected, eligible, disabled = false, onApply }: {
    api: ApiClient; text: string; networkText: Record<string, string>; mode: string; selected: readonly Account[]; eligible: readonly Account[]; disabled?: boolean;
    onApply: (value: { text: string; accountIds: string[] }, scope: string) => void;
}) {
    const [presets, setPresets] = useState<Preset[]>([]), [selection, setSelection] = useState<string | null>(null), [name, setName] = useState('');
    const [busy, setBusy] = useState(false), [hidden, setHidden] = useState(false), [error, setError] = useState<string | null>(null);
    const generation = useRef(0), running = useRef(false), currentApi = useRef(api);
    currentApi.current = api;
    const latest = useRef({ mode, disabled, eligible, onApply }); latest.current = { mode, disabled, eligible, onApply };
    const current = presets.find(row => row.id === selection);
    function capture() {
        const scope = presetScopeToken(), version = generation.current;
        return { scope, valid: () => scope === presetScopeToken() && version === generation.current && api === currentApi.current };
    }
    async function reload(valid: () => boolean) {
        try { const rows = await fetchPresets(api); if (valid()) { setPresets(rows); setHidden(false); } }
        catch (err) {
            if (!valid()) return;
            if (err instanceof ApiError && [404, 503, 402, 403].includes(err.status)) setHidden(true);
            else setError(presetErrorKey(err));
        }
    }
    useEffect(() => {
        const reset = () => {
            const version = ++generation.current, scope = presetScopeToken();
            const valid = () => version === generation.current && scope === presetScopeToken() && api === currentApi.current;
            setPresets([]); setSelection(null); setName(''); setError(null); setHidden(false); setBusy(true); running.current = true;
            void reload(valid).finally(() => { if (valid()) { setBusy(false); running.current = false; } });
        };
        reset(); const userOff = subscribeCacheUser(reset), brandOff = brandStore.subscribe(reset);
        return () => { generation.current++; userOff(); brandOff(); };
        // reload uses this effect's API; each scope reset invalidates all earlier requests.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [api]);
    function apply() {
        if (!current || running.current || disabled || mode === 'queue') return;
        const { scope, valid } = capture(); let used = false;
        const finish = () => {
            if (used || !valid() || running.current || latest.current.disabled || latest.current.mode === 'queue') return;
            used = true;
            latest.current.onApply(applyPreset(current, latest.current.eligible.map(a => a.id)), scope);
        };
        if (Object.values(networkText).some(value => value.trim())) Alert.alert(t('publishDepth.presets.replaceTitle'), t('publishDepth.presets.replaceBody'), [
            { text: t('publish.cancel'), style: 'cancel' }, { text: t('publishDepth.presets.apply'), onPress: finish },
        ]);
        else finish();
    }
    function save() {
        if (running.current || disabled || mode === 'queue') return;
        const accountIds = selected.map(a => a.id);
        const problem = presetDraftProblem(name, text, accountIds);
        if (problem) return setError(problem);
        const { valid } = capture(); let used = false;
        const value = { id: selection, name, caption: text, accountIds };
        Alert.alert(t('publishDepth.presets.save'), name.trim(), [
            { text: t('publish.cancel'), style: 'cancel' },
            { text: t('publishDepth.presets.save'), onPress: async () => {
                if (used || !valid() || running.current || latest.current.disabled || latest.current.mode === 'queue') return;
                used = true; running.current = true; setBusy(true); setError(null);
                try {
                    await savePreset(api, value);
                    if (valid()) await reload(valid);
                } catch (err) { if (valid()) setError(presetErrorKey(err)); }
                finally { if (valid()) { running.current = false; setBusy(false); } }
            } },
        ]);
    }

    function remove() {
        if (!current || running.current || disabled) return;
        const { valid } = capture(); let used = false;
        Alert.alert(t('publishDepth.presets.deleteTitle'), t('publishDepth.presets.deleteBody', { name: current.name }), [
            { text: t('publish.cancel'), style: 'cancel' },
            { text: t('publishDepth.presets.delete'), style: 'destructive', onPress: async () => {
                if (used || !valid() || running.current || latest.current.disabled) return;
                used = true; running.current = true; setBusy(true); setError(null);
                try {
                    await deletePreset(api, current.id);
                    if (valid()) { setSelection(null); setName(''); await reload(valid); }
                } catch (err) { if (valid()) setError(presetErrorKey(err)); }
                finally { if (valid()) { running.current = false; setBusy(false); } }
            } },
        ]);
    }
    if (hidden) return null;
    const locked = busy || disabled;
    const button = (key: string, action: () => void, off = false) => <Pressable style={touchTarget} accessibilityRole="button" accessibilityState={{ busy, disabled: locked || off }} disabled={locked || off} onPress={action}><Text style={[styles.action, (locked || off) && styles.off]}>{t(key)}</Text></Pressable>;
    return <View style={styles.list} accessibilityState={{ busy }}>
        <Text style={styles.text} accessibilityRole="header">{t('publishDepth.presets.title')}</Text>
        {busy ? <ActivityIndicator accessibilityState={{ busy: true }} /> : null}
        <View style={styles.chips}>{presets.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected: selection === row.id, disabled: locked }} disabled={locked} style={[touchTarget, styles.chip]} onPress={() => { setSelection(row.id); setName(row.name); }}><Text style={selection === row.id ? styles.action : styles.text}>{row.name}</Text></Pressable>)}</View>
        {button('publishDepth.presets.new', () => { setSelection(null); setName(''); })}
        <Text style={styles.muted}>{t('publishDepth.presets.name')}</Text>
        <TextInput style={styles.input} accessibilityLabel={t('publishDepth.presets.name')} value={name} onChangeText={setName} maxLength={80} editable={!locked} />
        {mode === 'queue' ? <Text style={styles.muted}>{t('publishDepth.presets.queueNote')}</Text> : null}
        <View style={styles.chips}>
            {button('publishDepth.presets.apply', apply, mode === 'queue' || !current)}
            {button('publishDepth.presets.save', save, mode === 'queue')}
            {button('publishDepth.presets.delete', remove, !current)}
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{t(error)}</Text> : null}
    </View>;
}
const styles = StyleSheet.create({ list: { gap: 6 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, chip: { paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.surface }, input: { color: colors.text, backgroundColor: colors.surface, padding: 12, minHeight: 44 }, text: { color: colors.text }, muted: { color: colors.muted }, action: { color: colors.accent }, error: { color: colors.danger }, off: { opacity: 0.4 } });
