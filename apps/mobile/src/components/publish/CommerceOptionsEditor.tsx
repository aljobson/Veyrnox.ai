import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { formatNumber, t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';
import { MAX_COLLECTIONS, MAX_OPTIONS, type OptionsForm, type VariantForm } from '../../lib/publishCommerceOptions';
import { colors } from '../../theme';

interface Props { value: OptionsForm; onChange(next: OptionsForm): void; writable: boolean; defaultPrice: string }

export function CommerceOptionsEditor({ value, onChange, writable, defaultPrice }: Props) {
    const variant = (index: number, key: keyof VariantForm, text: string) => onChange({
        ...value, variants: value.variants.map((v, i) => i === index ? { ...v, [key]: text } : v),
    });
    const input = (label: string, text: string, change: (text: string) => void, extra: TextInputProps = {}) => (
        <>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={styles.input} value={text} onChangeText={change} editable={writable} accessibilityLabel={rawText(label)} placeholderTextColor={colors.muted} {...extra} />
        </>
    );
    const button = (label: string, action: () => void, accessibilityLabel = label) => writable ? (
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(accessibilityLabel)} style={[styles.button, touchTarget]} onPress={action}>
            <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
    ) : null;
    return (
        <View style={styles.body}>
            <Text style={styles.heading} accessibilityRole="header">{t('commerce.options')}</Text>
            {!value.variants.length ? <Text style={styles.muted}>{t('commerce.optionsHelp')}</Text> : null}
            {value.variants.map((v, index) => {
                const slots = { number: formatNumber(index + 1) };
                return <View key={index} style={styles.body}>
                    {input(t('commerce.optionNameLabel', slots), v.title, text => variant(index, 'title', text), { maxLength: 120, placeholder: t('commerce.optionName') })}
                    {input(t('commerce.optionSkuLabel', slots), v.sku, text => variant(index, 'sku', text), { maxLength: 100, autoCapitalize: 'characters', autoCorrect: false })}
                    <View style={styles.row}>
                        <View style={styles.half}>{input(t('commerce.optionPriceLabel', slots), v.price, text => variant(index, 'price', text), { keyboardType: 'decimal-pad' })}</View>
                        <View style={styles.half}>{input(t('commerce.optionStockLabel', slots), v.stock, text => variant(index, 'stock', text), { keyboardType: 'number-pad', maxLength: 9 })}</View>
                    </View>
                    {button(t('commerce.removeOption'), () => onChange({ ...value, variants: value.variants.filter((_, i) => i !== index) }), t('commerce.removeOptionLabel', slots))}
                </View>;
            })}
            {value.variants.length < MAX_OPTIONS ? button(t('commerce.addOption'), () => onChange({ ...value, variants: [...value.variants, { title: '', sku: '', price: defaultPrice || '0', stock: '0' }] })) : null}
            <Text style={styles.heading} accessibilityRole="header">{t('commerce.collections')}</Text>
            <Text style={styles.muted}>{t('commerce.collectionsHelp')}</Text>
            {value.collections.map((collection, index) => {
                const slots = { number: formatNumber(index + 1) };
                return <View key={index} style={styles.body}>
                    {input(t('commerce.collectionNameLabel', slots), collection, text => onChange({ ...value, collections: value.collections.map((c, i) => i === index ? text : c) }), { maxLength: 80, autoCorrect: false })}
                    {button(t('commerce.removeOption'), () => onChange({ ...value, collections: value.collections.filter((_, i) => i !== index) }), t('commerce.removeCollectionLabel', slots))}
                </View>;
            })}
            {value.collections.length < MAX_COLLECTIONS ? button(t('commerce.addCollection'), () => onChange({ ...value, collections: [...value.collections, ''] })) : null}
            <Text style={styles.heading} accessibilityRole="header">{t('commerce.discount')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={rawText(t('commerce.discount'))} style={styles.row}>
                {(['', 'percent', 'fixed'] as const).map((type, index) => (
                    <Pressable key={type} accessibilityRole="radio" accessibilityLabel={rawText(t(['commerce.noDiscount', 'commerce.percentOff', 'commerce.amountOff'][index]))}
                        disabled={!writable} accessibilityState={{ checked: value.discountType === type, disabled: !writable }}
                        style={[styles.button, touchTarget, value.discountType === type && styles.selected]}
                        onPress={() => { if (value.discountType !== type) onChange({ ...value, discountType: type, discountValue: '' }); }}>
                        <Text style={styles.buttonText}>{t(['commerce.noDiscount', 'commerce.percentOff', 'commerce.amountOff'][index])}</Text>
                    </Pressable>
                ))}
            </View>
            {value.discountType ? input(t(value.discountType === 'percent' ? 'commerce.discountPercent' : 'commerce.discountAmount'), value.discountValue, discountValue => onChange({ ...value, discountValue }), { keyboardType: 'decimal-pad' }) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    body: { gap: 8 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 16 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 8 },
    input: { backgroundColor: colors.surface, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    muted: { color: colors.muted, fontSize: 13 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    half: { flex: 1 },
    button: { justifyContent: 'center', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong },
    selected: { borderColor: colors.accent, backgroundColor: colors.surface },
    buttonText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
