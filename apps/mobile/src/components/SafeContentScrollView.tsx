import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { ScrollView } from 'react-native';
import type { ScreenInsets } from '../lib/modalLayout';
import { useOptionalSafeAreaInsets } from '../lib/safeArea';
import { KeyboardFormScrollView } from './KeyboardFormScrollView';
import { KeyboardScreen } from './KeyboardScreen';

export function screenSafePadding(insets: ScreenInsets, gutter: number, includeTopInset = false): ViewStyle {
    return {
        paddingTop: gutter + (includeTopInset ? insets.top : 0),
        paddingRight: gutter + insets.right,
        paddingBottom: gutter + insets.bottom,
        paddingLeft: gutter + insets.left,
    };
}

type SafeContentProps = ScrollViewProps & {
    gutter: number;
    includeTopInset?: boolean;
};

export function SafeContentScrollView({ contentContainerStyle, gutter, includeTopInset = false, ...props }: SafeContentProps) {
    const insets = useOptionalSafeAreaInsets();
    return <ScrollView {...props} contentContainerStyle={[contentContainerStyle, screenSafePadding(insets, gutter, includeTopInset)]} />;
}

export function SafeKeyboardFormScrollView({ contentContainerStyle, gutter, includeTopInset = false, style, ...props }: SafeContentProps) {
    const insets = useOptionalSafeAreaInsets();
    return <KeyboardScreen style={style as StyleProp<ViewStyle>}>
        <KeyboardFormScrollView {...props} contentContainerStyle={[contentContainerStyle, screenSafePadding(insets, gutter, includeTopInset)]} />
    </KeyboardScreen>;
}
