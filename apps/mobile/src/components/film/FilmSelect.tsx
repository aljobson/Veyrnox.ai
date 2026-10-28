import { rawText } from '../../lib/i18n/translate';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PickSheet, type PickChoice } from '../oddlings/PickSheet';
import { touchTarget } from '../../lib/a11y';
import { colors } from '../../theme';

export function FilmSelect({ label, value, options, onChange }: {
    label: string; value: string; options: readonly PickChoice[]; onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const current = options.find(option => option.value === value)?.label ?? value;
    return <View>
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(`${label}, ${current}`)} onPress={() => setOpen(true)}
            style={{ ...touchTarget, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 6 }}>
            <Text style={{ color: colors.muted }}>{label}</Text>
            <Text style={{ color: colors.text }}>{current}</Text>
        </Pressable>
        {open ? <PickSheet title={label} choices={options} value={value} noneLabel={null} onPick={onChange} onClose={() => setOpen(false)} /> : null}
    </View>;
}
