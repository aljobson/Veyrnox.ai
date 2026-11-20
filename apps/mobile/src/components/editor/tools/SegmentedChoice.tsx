import { Text, View } from 'react-native';
import { Choice } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { rawText } from '../../../lib/i18n';
export function SegmentedChoice({ label, value, options, onChange }: {
    label: string; value: string; options: readonly { value: string; label: string }[]; onChange(value: string): void;
}) {
    return <View><Text style={styles.fieldLabel}>{label}</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={rawText(label)} style={styles.choices}>
            {options.map(option => <Choice key={option.value} label={option.label} selected={value === option.value} onPress={() => onChange(option.value)} />)}
        </View>
    </View>;
}
