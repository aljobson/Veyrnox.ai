import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { UnlockCard } from '../../../components/UnlockCard';
import { touchTarget } from '../../../lib/a11y';
import { ApiError } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import {
    buildProductBody, commerceErrorKey, emptyProductForm, fetchProductPage, formFromProduct, saveProduct, type ProductForm,
} from '../../../lib/publishCommerce';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

// ADR-0229: a catalogue entry. Nothing here posts, sells or charges.
export default function CommerceEdit() {
    const api = usePublishApi();
    const router = useRouter();
    const { id } = useLocalSearchParams<{ id?: string }>();
    const [form, setForm] = useState<ProductForm>(emptyProductForm());
    const [ready, setReady] = useState(false);
    const [locked, setLocked] = useState(false);
    const [canEdit, setCanEdit] = useState(true);
    const [editable, setEditable] = useState(true);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetchProductPage(api)
            .then((page) => {
                if (cancelled) return;
                setCanEdit(page.canEdit);
                const found = id ? page.products.find((p) => p.id === id) : undefined;
                if (found) {
                    setForm(formFromProduct(found));
                    setEditable(found.editable);
                    if (!found.editable) setProblem(t(found.keep ? 'commerce.err.notEditable' : 'commerce.err.editOnWeb'));
                } else if (id) {
                    setEditable(false);
                    setProblem(t('commerce.err.gone'));
                }
                setLocked(false);
                setReady(true);
            })
            .catch((err) => {
                if (cancelled) return;
                if (err instanceof ApiError && err.status === 402) setLocked(true);
                else setProblem(t(commerceErrorKey(err)));
                setReady(true);
            });
        return () => { cancelled = true; };
    }, [api, id, reload]);

    const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => setForm((f) => ({ ...f, [key]: value }));
    const writable = canEdit && editable;

    async function save() {
        if (busy || !writable) return;
        const built = buildProductBody(form);
        if ('errorKey' in built) {
            setProblem(t(built.errorKey));
            return;
        }
        setBusy(true);
        setProblem(null);
        try {
            await saveProduct(api, built.body);
            router.back();
        } catch (err) {
            if (err instanceof ApiError && err.status === 402) setLocked(true);
            else setProblem(t(commerceErrorKey(err)));
        } finally {
            setBusy(false);
        }
    }

    if (!ready) return <View style={styles.screen}><ActivityIndicator color={colors.accent} /></View>;
    if (locked) return <View style={styles.screen}><UnlockCard feature="commerce" onUnlocked={() => { setReady(false); setReload((n) => n + 1); }} /></View>;

    const input = (label: string, value: string, onChange: (v: string) => void, extra: object = {}) => (
        <>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={styles.input} value={value} onChangeText={onChange} editable={writable} accessibilityLabel={label} placeholderTextColor={colors.muted} {...extra} />
        </>
    );

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: id ? t('commerce.edit') : t('commerce.new') }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                <Text style={styles.note}>{t('commerce.note')}</Text>
                {!canEdit ? <Text style={styles.muted}>{t('commerce.readOnly')}</Text> : null}
                {input(t('commerce.name'), form.title, (v) => set('title', v), { maxLength: 160 })}
                {input(t('commerce.description'), form.description, (v) => set('description', v), { multiline: true, maxLength: 5000, style: [styles.input, styles.multi] })}
                {input(t('commerce.currency'), form.currency, (v) => set('currency', v.toUpperCase()), { maxLength: 3, autoCapitalize: 'characters', autoCorrect: false })}
                <View style={styles.row}>
                    <View style={styles.half}>{input(t('commerce.price'), form.price, (v) => set('price', v), { keyboardType: 'decimal-pad' })}</View>
                    <View style={styles.half}>{input(t('commerce.compareAt'), form.compareAt, (v) => set('compareAt', v), { keyboardType: 'decimal-pad' })}</View>
                </View>
                {input(t('commerce.stockLabel'), form.stock, (v) => set('stock', v), { keyboardType: 'number-pad', maxLength: 9 })}
                {input(t('commerce.productUrl'), form.productUrl, (v) => set('productUrl', v), { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url' })}
                {input(t('commerce.imageUrl'), form.imageUrl, (v) => set('imageUrl', v), { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url' })}
                <Text style={styles.muted}>{t('commerce.optionsWeb')}</Text>
                {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
                {writable ? (
                    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={[styles.button, touchTarget, busy && styles.off]} onPress={save}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('commerce.save')}</Text>}
                    </Pressable>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16 },
    body: { paddingVertical: 16, gap: 8 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    multi: { minHeight: 90 },
    note: { color: colors.accent, fontSize: 13 },
    muted: { color: colors.muted, fontSize: 13 },
    row: { flexDirection: 'row', gap: 8 },
    half: { flex: 1 },
    error: { color: colors.danger },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
});
