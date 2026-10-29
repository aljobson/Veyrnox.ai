import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Action, Card, Status, styles as ui } from '../account/shared';
import { FONTS } from '../../lib/brandKit';
import { emptyStyleForm, formFromStyle, styleFromForm, textStyleProblem, STYLE_MAX, STYLE_NAME_MAX, type StyleForm, type TextStyle } from '../../lib/brandKitStyles';
import { t } from '../../lib/i18n';
import { rawText } from '../../lib/i18n/translate';

export function BrandTextStyles({ styles, locked, onChange }: { styles: readonly unknown[]; locked: boolean; onChange(next: unknown[]): void }) {
    const [editing, setEditing] = useState<{ index: number; base?: TextStyle } | null>(null);
    const [form, setForm] = useState<StyleForm>(emptyStyleForm);
    const [error, setError] = useState<string | null>(null);
    const open = (index: number, base?: TextStyle) => { setEditing({ index, base }); setForm(base ? formFromStyle(base) : emptyStyleForm()); setError(null); };
    const field = (key: 'name' | 'size' | 'color' | 'background' | 'backgroundOpacity' | 'stroke' | 'strokeWidth') => {
        const label = t(key === 'backgroundOpacity' ? 'brand.style.opacity' : `brand.style.${key}`);
        return <View key={key}><Text style={ui.label}>{label}</Text><TextInput accessibilityLabel={label} style={ui.input} value={form[key]} maxLength={key === 'name' ? STYLE_NAME_MAX : undefined} keyboardType={key === 'size' ? 'number-pad' : 'default'} autoCapitalize="none" onChangeText={value => setForm({ ...form, [key]: value })} /></View>;
    };
    const choices = (key: 'font' | 'weight' | 'align', values: readonly string[]) => <View>
        <Text style={ui.label}>{t(`brand.style.${key}`)}</Text>
        {values.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={rawText(key === 'font' ? value : t(`brand.style.${value as 'normal' | 'bold' | 'left' | 'center' | 'right'}`))} accessibilityState={{ checked: form[key] === value }} style={ui.action} onPress={() => setForm({ ...form, [key]: value })}>
            <Text style={ui.actionText}>{form[key] === value ? '✓ ' : ''}{key === 'font' ? value : t(`brand.style.${value as 'normal' | 'bold' | 'left' | 'center' | 'right'}`)}</Text>
        </Pressable>)}
    </View>;
    const done = () => {
        if (!editing || locked) return;
        const result = styleFromForm(form, editing.base);
        if ('errorKey' in result) return setError(t(result.errorKey));
        if (editing.index < 0) { if (styles.length >= STYLE_MAX) return; onChange([...styles, result.style]); }
        else onChange(styles.map((s, i) => i === editing.index ? result.style : s));
        setEditing(null);
    };
    return <Card title={t('brand.styles')} help={t('brand.stylesHelp')}>
        {styles.map((value, index) => {
            const valid = textStyleProblem(value) === null, s = valid ? value as TextStyle : null;
            const name = s?.name ?? t('brand.style.unreadable');
            return <View key={index} style={{ gap: 8 }}>
                <Text style={ui.name}>{name}</Text>
                {s ? <><Text style={ui.help}>{t('brand.style.summary', { font: String(s.style.font), size: s.size })}</Text>
                    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ color: String(s.style.color), backgroundColor: `${s.style.background}${Math.round(Number(s.style.backgroundOpacity) * 255).toString(16).padStart(2, '0')}`, fontWeight: s.style.weight as 'normal' | 'bold', textAlign: s.style.align as 'left' | 'center' | 'right', fontStyle: s.style.italic ? 'italic' : 'normal', textDecorationLine: s.style.underline ? 'underline' : 'none' }}>{s.name}</Text></> : null}
                {!locked ? <>{s ? <Action label={t('brand.style.editLabel', { name })} onPress={() => open(index, s)} /> : null}
                    <Action label={t('brand.style.removeLabel', { name })} onPress={() => { onChange(styles.filter((_, i) => i !== index)); setEditing(null); }} /></> : null}
            </View>;
        })}
        {!locked && !editing && styles.length < STYLE_MAX ? <Action label={t('brand.style.add')} onPress={() => open(-1)} /> : null}
        {!locked && editing ? <View style={{ gap: 12 }}>
            {field('name')}{field('size')}{choices('font', FONTS)}{field('color')}{field('background')}{field('backgroundOpacity')}{field('stroke')}{field('strokeWidth')}
            {choices('weight', ['normal', 'bold'])}{choices('align', ['left', 'center', 'right'])}
            {(['italic', 'underline'] as const).map(key => <Pressable key={key} accessibilityRole="switch" accessibilityLabel={t(`brand.style.${key}`)} accessibilityState={{ checked: form[key] }} style={ui.action} onPress={() => setForm({ ...form, [key]: !form[key] })}><Text style={ui.actionText}>{form[key] ? '✓ ' : ''}{t(`brand.style.${key}`)}</Text></Pressable>)}
            <Status text={error} error /><Action label={t('brand.style.done')} onPress={done} /><Action label={t('brand.style.cancel')} onPress={() => setEditing(null)} />
        </View> : null}
    </Card>;
}
