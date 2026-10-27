import { DisabledTextContext } from './DisabledTextContext';
import { useAnnouncement, announcementText } from '../../lib/useAnnouncement';
import { useContext } from 'react';
import { FontStatus } from './FontStatus';
import { Text as NativeText, type TextProps as NativeProps } from 'react-native';
import { fontScaleCap } from '../../lib/a11y';
import { type TextVariant } from '../../theme';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export type TextProps = NativeProps & { variant?: TextVariant; tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'onAccent' | 'onMedia' | 'warning' };
export function Text({ variant = 'body', tone = 'primary', style, ...props }: TextProps) {
    useAnnouncement(props.accessibilityLiveRegion && props.accessibilityLiveRegion !== 'none' && props.accessibilityRole !== 'alert' ? announcementText(props.children) : null);
    const disabled = useContext(DisabledTextContext);
    const loadedFonts = useContext(FontStatus);
    const s = useThemedStyles(sheets);
    const heading = variant === 'display' || variant.startsWith('title');
    const face = s[variant].fontFamily;
    return (
        <NativeText
            accessibilityRole={heading ? 'header' : undefined}
            {...props}
            allowFontScaling
            maxFontSizeMultiplier={props.maxFontSizeMultiplier ?? fontScaleCap(variant)}
            style={[s[variant], s[tone], style, disabled && s.tertiary, face && !loadedFonts.has(face) ? fallback : undefined]}
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
