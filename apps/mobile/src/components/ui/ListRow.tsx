import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';
import { ds } from '../../theme';
import type { MenuIcon } from '../../lib/menuIcons';
import { Text } from './Text';
import { Icon } from './Icon';
import { themedStyles, useThemedStyles } from './AppearanceContext';
export function ListRow({ title, subtitle, icon, trailing, leading, style, ...props }: Omit<PressableProps, 'children'> & { title: ReactNode; subtitle?: ReactNode; icon?: MenuIcon; trailing?: ReactNode; leading?: ReactNode }) {
    const s = useThemedStyles(sheets);
    return (
        <Pressable {...props} accessibilityRole={props.accessibilityRole ?? "button"} style={(state) => [s.row, typeof style === 'function' ? style(state) : style]}>
            {leading ?? (icon ? <Icon name={icon} /> : null)}
            <View style={s.copy}>
                <Text variant="bodyStrong">{title}</Text>
                {subtitle ? (
                    <Text variant="footnote" tone="secondary">
                        {subtitle}
                    </Text>
                ) : null}
            </View>
            {trailing ?? <Icon name="caretRight" size={20} />}
        </Pressable>
    );
}
const sheets = themedStyles((p) => ({
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingVertical: ds.space.sm, borderBottomWidth: 0.5, borderColor: p.borderSubtle },
    copy: { flex: 1, gap: ds.space.xs },
}));
