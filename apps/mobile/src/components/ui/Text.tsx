import { useContext } from 'react';
import { FontStatus } from './FontStatus';
import { Text as NativeText, type TextProps as NativeProps } from 'react-native';
import { type TextVariant } from '../../theme';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export type TextProps = NativeProps & { variant?: TextVariant; tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'onAccent' | 'onMedia' | 'warning' };
export function Text({ variant = 'body', tone = 'primary', style, ...props }: TextProps) {
    const loadedFonts = useContext(FontStatus);
    const s = useThemedStyles(sheets);
    const heading = variant === 'display' || variant.startsWith('title');
    const face = s[variant].fontFamily;
    return (
        <NativeText
            accessibilityRole={heading ? 'header' : undefined}
            {...props}
            allowFontScaling
            maxFontSizeMultiplier={heading ? 1.5 : props.maxFontSizeMultiplier}
            style={[s[variant], s[tone], style, face && !loadedFonts.has(face) ? fallback : undefined]}
        />
    );
}
const fallback = { fontFamily: undefined };
const sheets = themedStyles((p, ramp) => ({
    ...ramp,
    primary: { color: p.textPrimary },
    secondary: { color: p.textSecondary },
    tertiary: { color: p.textTertiary },
    accent: { color: p.accent },
    danger: { color: p.danger },
    onAccent: { color: p.onAccent },
    onMedia: { color: p.onMedia },
    warning: { color: p.warning, fontVariant: ['tabular-nums'] },
}));
