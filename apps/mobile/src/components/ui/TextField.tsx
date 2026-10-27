import { useContext } from 'react';
import { FontStatus } from './FontStatus';
import { forwardRef, useState, type ReactNode, type ComponentRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { ds } from '../../theme';
import { Text } from './Text';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export type TextFieldProps = TextInputProps & { label?: string; error?: string; trailing?: ReactNode };
export const TextField = forwardRef<ComponentRef<typeof TextInput>, TextFieldProps>(function TextField({ label, error, trailing, style, onFocus, onBlur, ...props }, ref) {
    const [focused, setFocused] = useState(false);
    const loadedFonts = useContext(FontStatus);
    const s = useThemedStyles(sheets);
    const family = s.input.fontFamily;
    return (
        <View style={s.group}>
            {label ? (
                <Text variant="footnote" tone="secondary">{label}</Text>
            ) : null}
            <View style={[s.shell, focused && s.focus, !!error && s.error]}>
                <TextInput
                    {...props}
                    ref={ref}
                    accessibilityLabel={props.accessibilityLabel ?? label}
                    allowFontScaling
                    placeholderTextColor={s.placeholder.color}
                    style={[s.input, style, family && !loadedFonts.has(family) ? fallback : undefined]}
                    onFocus={(e) => {
                        setFocused(true);
                        onFocus?.(e);
                    }}
                    onBlur={(e) => {
                        setFocused(false);
                        onBlur?.(e);
                    }}
                />
                {trailing}
            </View>
            {error ? (
                <Text variant="footnote" tone="danger" accessibilityRole="alert">
                    {error}
                </Text>
            ) : null}
        </View>
    );
});
const fallback = { fontFamily: undefined };
const sheets = themedStyles((p, ramp) => ({
    group: { gap: ds.space.sm },
    shell: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: ds.space.md,
        backgroundColor: p.surface,
        borderColor: p.borderSubtle,
        borderWidth: 1,
        borderRadius: ds.radius.md,
    },
    input: { ...ramp.body, color: p.textPrimary, flex: 1, paddingVertical: ds.space.md },
    placeholder: { color: p.textTertiary },
    focus: { borderWidth: 1.5, borderColor: p.accent },
    error: { borderColor: p.danger },
}));
