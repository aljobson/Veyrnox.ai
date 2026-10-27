import { ControlLabelContext } from './ControlLabelContext';
import { getLocale } from '../../lib/i18n';
import { I18nManager } from 'react-native';
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
    const controlLabel = useContext(ControlLabelContext);
    const fitControl = controlLabel && getLocale() !== 'en' && props.accessibilityLanguage !== 'en';
    const loadedFonts = useContext(FontStatus);
    const s = useThemedStyles(sheets);
    const heading = variant === 'display' || variant.startsWith('title');
    const face = s[variant].fontFamily;
    // Fixed-height tabs and header captions keep one line, shrinking translated labels only.
    const fitCaption = getLocale() !== 'en' && props.accessibilityLanguage !== 'en' && variant === 'caption' && props.numberOfLines === 1;
    return (
        <NativeText
            accessibilityRole={heading ? 'header' : undefined}
            numberOfLines={fitControl ? 2 : undefined}
            adjustsFontSizeToFit={fitControl || fitCaption || undefined}
            minimumFontScale={fitControl || fitCaption ? 0.85 : undefined}
            {...props}
            allowFontScaling
            maxFontSizeMultiplier={props.maxFontSizeMultiplier ?? fontScaleCap(variant)}
            style={[I18nManager.isRTL ? { textAlign: 'right', writingDirection: 'rtl' } : undefined, s[variant], s[tone], fitControl && { flexShrink: 1, maxWidth: '100%' }, style, disabled && s.tertiary, face && !loadedFonts.has(face) ? fallback : undefined]}
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
