import { type ComponentRef, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View, type ViewProps } from 'react-native';

// Measure the actual screen origin, including navigation chrome and banners. Fixed
// 88/90pt guesses stop working with different safe areas or a visible offline strip.
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: ViewProps['style'] }) {
    const origin = useRef<ComponentRef<typeof View>>(null);
    const [offset, setOffset] = useState(0);
    return <View ref={origin} style={[{ flex: 1 }, style]} onLayout={() => {
        origin.current?.measureInWindow((_x, y) => setOffset(y));
    }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={offset}>
            {children}
        </KeyboardAvoidingView>
    </View>;
}
